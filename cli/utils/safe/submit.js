import { encodeFunctionData, getAddress, isAddress, isAddressEqual, isHex, parseAbi } from "viem";
import * as ows from "../wallet/keystore.js";
import { getReadonly } from "../wallet/readonly.js";
import { resolveChain } from "../chain/catalog.js";
import { getPublicClient, signAndSerialize, broadcastAndWait } from "../trading/transaction.js";
import { enforceExecutablePolicies, requireAgentToken } from "../trading/guards.js";
import { decideSafeSigningRoute } from "../trading/signing-route.js";
import { estimateGasWithFallback, NATIVE_TRANSFER_GAS, ERC20_TRANSFER_GAS } from "../trading/gas.js";
import { signViaWebApp, toTransactionEVM } from "../web-app/handoff.js";
import { getSafeChainInfo } from "./chain-info.js";
import { readSafeState, assertSupportedVersion, getOnchainSafeTxHash } from "./contracts.js";
import { requireSafeApiKey, createTxServiceClient, QUEUE_PAGE_LIMIT } from "./tx-service.js";
import { selectNonce, isStale } from "./nonce.js";
import { buildSafeTxMessage, toSafeTypedData, hashSafeTx, assertHashMatches, ZERO_ADDRESS } from "./safe-tx.js";
import { encodeSignatures, preApprovedSignature } from "./signatures.js";
import { signSafeTxAsOwner } from "./owner-sign.js";
import { pendingReceiptPath, writePendingReceipt } from "./pending-store.js";

const SAFE_EXEC_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function nonce() view returns (uint256)",
]);

// Safe-side cost of execTransaction on top of the inner call: signature checks, nonce write, events, guard hook.
export const SAFE_EXEC_OVERHEAD_GAS = 60_000n;

const SIGN_MODES = new Set(["typed", "hash"]);

const defaultDeps = {
  resolveChain,
  getPublicClient,
  getSafeChainInfo,
  createTxServiceClient,
  enforceExecutablePolicies,
  signSafeTxAsOwner,
  requireAgentToken,
  signAndSerialize,
  broadcastAndWait,
  signViaWebApp,
  keystoreEvmAddress: (walletName) => ows.getEvmAddress(walletName),
};

let deps = defaultDeps;

// Test seam: lets unit tests swap chain reads, signers and broadcast for stubs.
export function __setSubmitDepsForTests(overrides) {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
}

function submitError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

function validateCalls(calls) {
  if (!Array.isArray(calls) || calls.length !== 1) {
    throw submitError(
      "safe_operation_unsupported",
      `A Safe transaction carries exactly one call here; got ${Array.isArray(calls) ? calls.length : "none"}.`
    );
  }
  const [{ to, value, data }] = calls;
  if (typeof to !== "string" || !isAddress(to)) {
    throw submitError("safe_call_invalid", `Safe call target ${String(to)} is not a checksummed 0x address.`);
  }
  if (typeof value !== "bigint" || value < 0n) {
    throw submitError("safe_call_invalid", "Safe call value must be a non-negative bigint.");
  }
  if (typeof data !== "string" || !isHex(data, { strict: true }) || data.length % 2 !== 0) {
    throw submitError("safe_call_invalid", "Safe call data must be 0x-prefixed, even-length hex.");
  }
  return { to: getAddress(to), value, data };
}

function validateFlags(flags) {
  const { nonce, signMode = "typed" } = flags;
  if (nonce !== undefined && nonce !== "next" && !(typeof nonce === "string" && /^\d+$/.test(nonce))) {
    throw submitError("invalid_nonce", `Invalid --nonce ${String(nonce)}: use a decimal nonce or "next".`);
  }
  if (!SIGN_MODES.has(signMode)) {
    throw submitError("invalid_sign_mode", `Invalid --sign-mode ${String(signMode)}: use "typed" or "hash".`);
  }
  return signMode;
}

function resolveExecutor(executorName, signer) {
  if (executorName === signer.walletName) return signer;
  const ro = getReadonly(executorName);
  if (ro) return { walletName: executorName, address: getAddress(ro.address), readOnly: true };
  try {
    return { walletName: executorName, address: getAddress(deps.keystoreEvmAddress(executorName)), readOnly: false };
  } catch {
    throw submitError("wallet_not_found", `Executor wallet "${executorName}" not found.`, {
      suggestion: "List wallets with: zerion wallet list",
    });
  }
}

function executionSignature(signed, executor) {
  if (isAddressEqual(executor.address, signed.owner)) {
    return { owner: signed.owner, signature: preApprovedSignature(signed.owner) };
  }
  return { owner: signed.owner, signature: signed.signature };
}

function safeAppLink(shortName, safeAddress, safeTxHash) {
  if (!shortName) return null;
  return `https://app.safe.global/transactions/tx?safe=${shortName}:${safeAddress}&id=multisig_${safeAddress}_${safeTxHash}`;
}

async function assertExecutorGas({ client, safeAddress, executor, call }) {
  const fees = await client.estimateFeesPerGas();
  const innerGas = await estimateGasWithFallback({
    client,
    account: safeAddress,
    to: call.to,
    data: call.data,
    value: call.value,
    fallback: call.data === "0x" ? NATIVE_TRANSFER_GAS : ERC20_TRANSFER_GAS,
  });
  const gasLimit = innerGas + SAFE_EXEC_OVERHEAD_GAS;
  const cost = gasLimit * (fees.maxFeePerGas || 0n);
  const balance = await client.getBalance({ address: executor.address });
  if (balance < cost) {
    throw submitError(
      "safe_executor_insufficient_gas",
      `Executor "${executor.walletName}" (${executor.address}) has ${balance} wei; executing needs about ${cost} wei of gas.`,
      { suggestion: "Fund the executor, or retry with --propose-only to collect signatures in the Safe app." }
    );
  }
  return { gasLimit };
}

async function execute({ client, chain, chainIdNum, safeAddress, message, safeTxHash, signatures, executor, preflight, timeout }) {
  const data = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [
      message.to,
      BigInt(message.value),
      message.data,
      0,
      0n,
      0n,
      0n,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      signatures,
    ],
  });
  const gas = await estimateGasWithFallback({
    client,
    account: executor.address,
    to: safeAddress,
    data,
    fallback: preflight.gasLimit,
  });
  const [nonce, fees] = await Promise.all([
    client.getTransactionCount({ address: executor.address, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);
  const tx = {
    type: "eip1559",
    chainId: chainIdNum,
    to: safeAddress,
    value: 0n,
    data,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    nonce,
  };

  if (executor.readOnly) {
    const evm = toTransactionEVM(tx, { chainIdNum, from: executor.address });
    const result = await deps.signViaWebApp({
      address: executor.address,
      transactions: [{ evm, label: `Execute Safe tx ${safeTxHash.slice(0, 10)}` }],
      timeout,
      client,
    });
    if (result.status !== "completed") {
      throw submitError(
        "safe_execute_failed",
        `Executing the Safe transaction in the Zerion web app ended with status "${result.status}"` +
          `${result.error || result.reason ? `: ${result.error || result.reason}` : "."}`,
        { status: result.status }
      );
    }
    return result.hashes[0];
  }

  const passphrase = await deps.requireAgentToken("for trading", executor.walletName);
  const signedTxHex = await deps.signAndSerialize(tx, chain, executor.walletName, passphrase);
  const receipt = await deps.broadcastAndWait(client, signedTxHex, { timeout });
  if (receipt.status !== "success") {
    throw submitError("safe_execute_failed", `execTransaction ${receipt.hash} reverted on-chain.`, {
      hash: receipt.hash,
    });
  }
  return receipt.hash;
}

async function propose({ txService, safeAddress, message, safeTxHash, signed }) {
  try {
    await txService.propose({ safeAddress, message, safeTxHash, sender: signed.owner, signature: signed.signature });
  } catch (err) {
    if (err.code !== "safe_tx_service_error") throw err;
    let stored;
    try {
      stored = await txService.getTransaction(safeTxHash);
    } catch {
      throw submitError(
        "safe_tx_service_error",
        `Proposing ${safeTxHash} failed and the Safe Transaction Service could not confirm whether it stored it: ${err.message}`,
        {
          status: err.status,
          suggestion: "The outcome is unknown. Check `zerion safe queue` before retrying, so the Safe does not get a second proposal.",
        }
      );
    }
    if (!stored) throw err;
  }
}

/**
 * Pre-flight, sign and execute or propose one Safe transaction for `signer`.
 * Every step before the owner signature fails closed with an Error carrying `.code`.
 */
export async function submitSafeCalls({ safe, signer, chain, calls, usdValue = null, flags = {} }) {
  const call = validateCalls(calls);
  const signMode = validateFlags(flags);
  const safeAddress = getAddress(safe.address);

  const chainConfig = await deps.resolveChain(chain);
  if (!chainConfig?.chainIdNum) {
    throw submitError("unsupported_chain", `Unsupported chain: ${chain}`);
  }
  const chainIdNum = chainConfig.chainIdNum;

  const chainInfo = await deps.getSafeChainInfo(chainIdNum);
  const apiKey = requireSafeApiKey(chainInfo);
  const txService = chainInfo.txServiceUrl
    ? deps.createTxServiceClient({ baseUrl: chainInfo.txServiceUrl, apiKey })
    : null;

  const client = await deps.getPublicClient(chain);
  const state = await readSafeState(client, safeAddress);
  assertSupportedVersion(state.version);
  if (!state.owners.some((owner) => isAddressEqual(owner, signer.address))) {
    throw submitError(
      "safe_signer_not_owner",
      `Signer "${signer.walletName}" (${signer.address}) is not a current owner of Safe ${safeAddress} on ${chain}.`
    );
  }

  await deps.enforceExecutablePolicies({ ...call, chain, walletName: signer.walletName });

  const queued = txService ? await txService.listQueued(safeAddress, { nonceGte: state.nonce }) : [];
  if (flags.nonce === undefined && queued.length >= QUEUE_PAGE_LIMIT) {
    throw submitError(
      "safe_queue_truncated",
      `Safe ${safeAddress} has at least ${QUEUE_PAGE_LIMIT} queued transactions at or above nonce ${state.nonce}, ` +
        "so the next free nonce cannot be read from one page.",
      { suggestion: "Pick the nonce yourself with --nonce N, or --nonce next to replace the on-chain nonce." }
    );
  }
  const { nonce, conflict } = selectNonce({ onchainNonce: state.nonce, queued, requested: flags.nonce });
  if (conflict) {
    process.stderr.write(
      `WARNING: nonce ${nonce} is already used by queued Safe transaction ${conflict.safeTxHash}; ` +
        "only one of them can execute.\n"
    );
  }

  const message = buildSafeTxMessage({ ...call, nonce });
  const typedData = toSafeTypedData({ chainId: chainIdNum, safeAddress, message });
  const safeTxHash = hashSafeTx(typedData);
  assertHashMatches(safeTxHash, await getOnchainSafeTxHash(client, safeAddress, message));

  const executor = resolveExecutor(safe.executor ?? signer.walletName, signer);
  const executorPreApproves =
    state.owners.some((owner) => isAddressEqual(owner, executor.address)) &&
    !isAddressEqual(executor.address, signer.address);
  let canExecute = !flags.proposeOnly && state.threshold <= 1 + (executorPreApproves ? 1 : 0);
  if (canExecute && nonce !== state.nonce) {
    if (!txService) {
      throw submitError(
        "safe_nonce_not_executable",
        `Nonce ${nonce} is ahead of the Safe's on-chain nonce ${state.nonce}, so it cannot execute now, ` +
          `and chain ${chain} has no Safe Transaction Service to queue it.`,
        { suggestion: "Retry with --nonce next." }
      );
    }
    process.stderr.write(
      `Nonce ${nonce} is ahead of the Safe's on-chain nonce ${state.nonce}; proposing instead of executing.\n`
    );
    canExecute = false;
  }
  if (!canExecute && !txService) {
    throw submitError(
      "safe_threshold_unreachable_no_tx_service",
      `Safe ${safeAddress} needs ${state.threshold} signatures, this run can collect fewer, ` +
        `and chain ${chain} has no Safe Transaction Service to collect the rest.`
    );
  }

  const preflight = canExecute ? await assertExecutorGas({ client, safeAddress, executor, call }) : null;

  const { route, reason } = decideSafeSigningRoute({
    safeName: safe.name,
    signerName: signer.walletName,
    force: Boolean(flags.review),
    usdValue,
  });
  process.stderr.write(`Signing route: ${route} — ${reason}.\n`);
  const signed = await deps.signSafeTxAsOwner({
    typedData,
    safeTxHash,
    chainIdNum,
    signer,
    route,
    signMode,
    timeout: flags.timeout,
  });

  const onchainNonce = await client.readContract({ address: safeAddress, abi: SAFE_EXEC_ABI, functionName: "nonce" });
  if (isStale(nonce, onchainNonce)) {
    throw submitError(
      "safe_nonce_stale",
      `Nonce ${nonce} was used while this transaction was being signed: the Safe's on-chain nonce is now ${onchainNonce}. ` +
        "Nothing was executed or proposed.",
      { nonce: nonce.toString(), onchainNonce: onchainNonce.toString() }
    );
  }

  let entries;
  let status;
  let txHash;
  if (canExecute) {
    entries = [executionSignature(signed, executor)];
    if (entries.length < state.threshold && executorPreApproves) {
      entries.push({ owner: executor.address, signature: preApprovedSignature(executor.address) });
    }
    txHash = await execute({
      client,
      chain,
      chainIdNum,
      safeAddress,
      message,
      safeTxHash,
      signatures: encodeSignatures(entries),
      executor,
      preflight,
      timeout: flags.timeout,
    });
    status = "executed";
  } else {
    entries = [{ owner: signed.owner, signature: signed.signature }];
    await propose({ txService, safeAddress, message, safeTxHash, signed });
    status = "proposed";
  }

  try {
    writePendingReceipt({
      safeAddress,
      chainId: chainIdNum,
      safeTxHash,
      typedData,
      signatures: Object.fromEntries(entries.map(({ owner, signature }) => [getAddress(owner), signature])),
      status,
    });
  } catch (err) {
    process.stderr.write(
      `WARNING: the Safe transaction was ${status}, but its local receipt could not be written to ` +
        `${pendingReceiptPath({ safeAddress, chainId: chainIdNum, safeTxHash })}: ${err.message}\n`
    );
  }

  return {
    chain,
    safe: safeAddress,
    safeTxHash,
    nonce: nonce.toString(),
    status,
    confirmations: `${entries.length}/${state.threshold}`,
    link: safeAppLink(chainInfo.shortName, safeAddress, safeTxHash),
    ...(txHash ? { txHash } : {}),
    signedVia: signed.signedVia,
    signMode: signed.signMode,
    route: reason,
  };
}
