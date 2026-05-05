/**
 * Transaction helpers — bridge between Zerion API tx objects, viem, and OWS.
 */

import {
  serializeTransaction,
  createPublicClient,
  http,
  fallback,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { resolveChain } from "../chain/catalog.js";
import * as ows from "../wallet/keystore.js";

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/**
 * Resolve a Zerion chain ID to a viem chain config via the live API catalog.
 * Throws if the chain is unknown or missing the metadata needed for signing.
 */
async function getChainConfig(zerionChainId) {
  const config = await resolveChain(zerionChainId);
  if (!config || !config.viemChain || !config.chainIdNum) {
    const err = new Error(`Unsupported chain: ${zerionChainId}`);
    err.code = "unsupported_chain";
    throw err;
  }
  return config;
}

// Public RPCs in the chain catalog rotate (some return 403/429 today, work
// tomorrow). Stack them behind a fallback transport so viem retries the next
// one on failure instead of bailing on the first dead endpoint.
function buildTransport(rpcHttpUrls) {
  if (!rpcHttpUrls || rpcHttpUrls.length === 0) return http();
  if (rpcHttpUrls.length === 1) return http(rpcHttpUrls[0]);
  return fallback(rpcHttpUrls.map((url) => http(url)), { rank: false });
}

/**
 * Get a viem public client for a Zerion chain ID. Async — the chain catalog is
 * fetched from the API on first use and cached for the rest of the process.
 */
export async function getPublicClient(zerionChainId) {
  const config = await getChainConfig(zerionChainId);
  return createPublicClient({
    chain: config.viemChain,
    transport: buildTransport(config.rpcHttpUrls),
  });
}

/**
 * Build and sign an EVM transaction from Zerion swap API response.
 *
 * @param {object} swapTx - tx body from /swap/quotes/ (transaction_swap.evm or transaction_approve.evm)
 * @param {string} zerionChainId
 * @param {string} walletName
 * @param {string} passphrase
 * @param {object} [opts]
 * @param {number} [opts.nonceOverride] - explicit nonce to use instead of querying the RPC.
 *   Required when broadcasting a swap right after an approval — public RPCs often
 *   still report the pre-approval nonce as "latest" even after waitForTransactionReceipt
 *   resolves, so we track it locally instead of trusting the node.
 * @returns {{ signedTxHex: string, client: object, tx: object }}
 */
export async function signSwapTransaction(swapTx, zerionChainId, walletName, passphrase, { nonceOverride } = {}) {
  if (!swapTx) {
    throw new Error("No transaction data from swap API — the quote may require more balance or the pair is unsupported");
  }

  const config = await getChainConfig(zerionChainId);
  const client = createPublicClient({
    chain: config.viemChain,
    transport: buildTransport(config.rpcHttpUrls),
  });
  const walletAddress = ows.getEvmAddress(walletName);

  const feeData = await client.estimateFeesPerGas();
  const nonce = nonceOverride ?? (await client.getTransactionCount({ address: walletAddress, blockTag: "latest" }));

  const chainId = config.chainIdNum;

  const tx = {
    type: "eip1559",
    chainId,
    to: swapTx.to,
    data: swapTx.data,
    value: BigInt(swapTx.value || "0"),
    gas: BigInt(swapTx.gas || "200000"),
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    nonce,
  };

  const signedTxHex = await signAndSerialize(tx, zerionChainId, walletName, passphrase);
  return { signedTxHex, client, tx };
}

/**
 * Sign a transaction object with OWS and return the serialized signed hex.
 * Centralizes the serialize -> sign -> split-signature -> re-serialize pattern.
 */
export async function signAndSerialize(tx, zerionChainId, walletName, passphrase) {
  const config = await getChainConfig(zerionChainId);
  const unsignedTxHex = serializeTransaction(tx);
  const signResult = ows.signEvmTransaction(walletName, unsignedTxHex, passphrase, config.caip2);

  const sigHex = signResult.signature;
  const r = `0x${sigHex.slice(0, 64)}`;
  const s = `0x${sigHex.slice(64, 128)}`;
  const yParity = signResult.recoveryId;

  return serializeTransaction(tx, { r, s, yParity });
}

/**
 * Broadcast a signed transaction and wait for receipt.
 * @param {object} client - viem public client
 * @param {string} signedTxHex - signed transaction hex
 * @param {object} [options]
 * @param {number} [options.timeout] - timeout in seconds (default 120)
 * @param {boolean} [options.isCrossChain] - if true, print bridge-specific progress
 */
export async function broadcastAndWait(client, signedTxHex, { timeout = 120, isCrossChain = false } = {}) {
  process.stderr.write("Broadcasting transaction...\n");

  let hash;
  try {
    hash = await client.sendRawTransaction({
      serializedTransaction: signedTxHex,
    });
  } catch (err) {
    const error = new Error(
      `Transaction broadcast failed: ${err.message}. ` +
      `Common causes: insufficient gas balance, nonce conflict, or network congestion.`
    );
    error.code = "broadcast_failed";
    throw error;
  }

  process.stderr.write(`Tx hash: ${hash}\n`);
  process.stderr.write("Waiting for confirmation...\n");

  const timeoutMs = timeout * 1000;
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  } catch (err) {
    if (err.name === "TimeoutError" || err.message?.includes("timed out")) {
      const error = new Error(
        `Transaction ${hash} was broadcast but not confirmed within ${timeout}s. ` +
        `It may still confirm — check a block explorer before retrying to avoid double-spend.`
      );
      error.code = "confirmation_timeout";
      error.hash = hash;
      throw error;
    }
    throw err;
  }

  const result = {
    hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
  };

  if (isCrossChain) {
    process.stderr.write("Source chain transaction confirmed.\n");
    result.bridgeStatus = "source_confirmed";
  }

  return result;
}

/**
 * Build and execute an ERC-20 approval transaction.
 * Approves only the exact amount needed (not unlimited).
 */
export async function approveErc20(tokenAddress, spender, amount, zerionChainId, walletName, passphrase) {
  const config = await getChainConfig(zerionChainId);
  const client = createPublicClient({
    chain: config.viemChain,
    transport: buildTransport(config.rpcHttpUrls),
  });
  const walletAddress = ows.getEvmAddress(walletName);

  const [nonce, feeData] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);

  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, amount],
  });

  const chainId = config.chainIdNum;

  // Estimate gas for the approval — don't hardcode, chains vary
  let gasEstimate;
  try {
    gasEstimate = await client.estimateGas({
      account: walletAddress,
      to: tokenAddress,
      data,
      value: 0n,
    });
    // Add 20% buffer
    gasEstimate = (gasEstimate * 120n) / 100n;
  } catch (err) {
    process.stderr.write(`Warning: gas estimation failed, using 100000 fallback: ${err.message}\n`);
    gasEstimate = 100000n;
  }

  const tx = {
    type: "eip1559",
    chainId,
    to: tokenAddress,
    data,
    value: 0n,
    gas: gasEstimate,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    nonce,
  };

  const signedTxHex = await signAndSerialize(tx, zerionChainId, walletName, passphrase);
  return broadcastAndWait(client, signedTxHex);
}
