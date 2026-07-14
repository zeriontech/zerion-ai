import { encodeFunctionData, parseAbi, parseEther, parseUnits, formatEther, formatUnits } from "viem";
import { resolveToken } from "../../utils/trading/resolve-token.js";
import { requireAgentToken, parseTimeout, handleTradingError, enforceExecutablePolicies } from "../../utils/trading/guards.js";
import * as api from "../../utils/api/client.js";
import { getPublicClient, broadcastAndWait, signAndSerialize } from "../../utils/trading/transaction.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { toTransactionEVM, toSolanaTransaction, signViaWebApp, reportHandoff } from "../../utils/web-app/handoff.js";
import { decideSigningRoute } from "../../utils/trading/signing-route.js";
import { bundleSellUsd } from "../../utils/trading/valuation.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { NATIVE_ASSET_ADDRESS } from "../../utils/common/constants.js";
import { formatSwapQuote } from "../../utils/common/format.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";
import { isSolana } from "../../utils/chain/registry.js";
import { sendSolanaNative } from "../../utils/chain/solana-send.js";
import { buildUnsignedSolanaTransfer, solanaReceiptAdapter } from "../../utils/chain/solana-handoff.js";

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export default async function send(args, flags) {
  const [token, amount] = args;
  const to = flags.to;

  if (!token || !amount) {
    printError("missing_args", "Usage: zerion send <token> <amount> --to <address> [--chain <chain>]", {
      example: "zerion send ETH 0.01 --to 0x... --chain base",
    });
    process.exit(1);
  }

  if (!to) {
    printError("missing_to", "Recipient address required (--to)", {
      example: `zerion send ${token} ${amount} --to 0x...`,
    });
    process.exit(1);
  }

  // Detect address type → infer chain when not passed explicitly.
  const recipientIsEvm = EVM_ADDR_RE.test(to);
  const recipientIsSolana = !recipientIsEvm && SOL_ADDR_RE.test(to);

  if (!recipientIsEvm && !recipientIsSolana && !to.endsWith(".eth")) {
    printError("invalid_address", `Invalid recipient address: ${to}`, {
      suggestion: "Provide a 0x EVM address (42 hex chars), an ENS name, or a Solana base58 pubkey.",
    });
    process.exit(1);
  }

  const chain = flags.chain
    || (recipientIsSolana ? "solana" : null)
    || getConfigValue("defaultChain")
    || "ethereum";

  // Reject obvious mismatches between recipient and chain.
  if (recipientIsSolana && !isSolana(chain)) {
    printError("chain_mismatch", `Recipient ${to} is a Solana address but --chain is "${chain}".`, {
      suggestion: `Use --chain solana, or provide a recipient on ${chain}.`,
    });
    process.exit(1);
  }
  if (recipientIsEvm && isSolana(chain)) {
    printError("chain_mismatch", `Recipient ${to} is an EVM address but --chain is solana.`, {
      suggestion: "Use --chain <evm-chain> or provide a Solana recipient.",
    });
    process.exit(1);
  }

  // Solana send routes here — separate flow, not the EVM pipeline below.
  if (isSolana(chain)) {
    return sendOnSolana({ token, amount, to, flags });
  }

  const { walletName, address } = resolveWallet({ ...flags, chain });

  const chainCheck = await validateTradingChainAsync(chain, "send");
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, { supportedChains: chainCheck.error.supportedChains });
    process.exit(1);
  }

  try {
    // Resolve token to get decimals and on-chain address
    const resolved = await resolveToken(token, chain);
    const isNative = resolved.address === NATIVE_ASSET_ADDRESS;

    // For ERC-20s: resolve chain-specific contract address if not already known
    if (!isNative && !resolved.address) {
      const fungible = await api.getFungible(resolved.fungibleId);
      const impl = fungible?.data?.attributes?.implementations?.find(
        (i) => i.chain_id === chain
      );
      if (impl?.address) {
        resolved.address = impl.address;
        if (impl.decimals != null) resolved.decimals = impl.decimals;
      }
    }

    // Compute amount in smallest units
    const amountParsed = isNative
      ? parseEther(amount)
      : parseUnits(amount, resolved.decimals);

    const summary = {
      send: {
        token: resolved.symbol,
        amount,
        from: address,
        to,
        chain,
        type: isNative ? "native" : "erc20",
      },
    };

    const client = await getPublicClient(chain);
    // resolveWallet already returned the wallet's EVM address; use it directly
    // so read-only wallets (no keystore entry) resolve too.
    const walletAddress = address;

    const [nonce, feeData] = await Promise.all([
      client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]);

    // Native balance gate — must cover amount + estimated gas. Runs regardless
    // of signing route (defense in depth ahead of the human review).
    const balance = await client.getBalance({ address: walletAddress });
    const estimatedGasCost = 21000n * (feeData.maxFeePerGas || 0n);
    if (isNative && balance < amountParsed + estimatedGasCost) {
      printError("insufficient_balance",
        `Insufficient ${resolved.symbol}: have ${formatEther(balance)}, need ${amount} + gas (~${formatEther(estimatedGasCost)})`,
        { suggestion: `Check balance: zerion portfolio --chain ${chain}` }
      );
      process.exit(1);
    }

    const baseTx = {
      type: "eip1559",
      chainId: client.chain.id,
      // Fees are set for the local sign path; toTransactionEVM drops them for
      // the web-app handoff (the connected wallet re-estimates at sign time).
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      nonce,
    };

    const BALANCE_OF_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

    let tx;
    if (isNative) {
      tx = { ...baseTx, to, value: amountParsed, data: "0x", gas: 21000n };
    } else {
      const tokenAddress = resolved.address;
      if (!tokenAddress) {
        printError("no_contract", `Cannot resolve ERC-20 contract for ${resolved.symbol} on ${chain}`, {
          suggestion: `Try using the contract address directly: zerion send 0x... ${amount} --to ${to}`,
        });
        process.exit(1);
      }

      // ERC-20 balance gate.
      try {
        const tokenBalance = await client.readContract({
          address: tokenAddress,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [walletAddress],
        });
        if (tokenBalance < amountParsed) {
          printError("insufficient_balance",
            `Insufficient ${resolved.symbol}: have ${formatUnits(tokenBalance, resolved.decimals)}, need ${amount}`,
            { suggestion: `Check balance: zerion positions --chain ${chain}` }
          );
          process.exit(1);
        }
      } catch {
        // If balanceOf fails (non-standard token), proceed and let gas estimation catch it
      }

      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [to, amountParsed],
      });

      const gas = await estimateGasWithFallback(client, walletAddress, tokenAddress, data, 65000n);
      tx = { ...baseTx, to: tokenAddress, value: 0n, data, gas };
    }

    // Policy pre-filter — runs on BOTH signing routes, before a link is formed
    // or a tx is signed.
    await enforceExecutablePolicies({ to: tx.to, value: tx.value, data: tx.data, chain });

    const timeout = parseTimeout(flags.timeout);

    // Sell-side USD value drives the routing decision (send = amount × price).
    const usdValue = await bundleSellUsd({ fungibleId: resolved.fungibleId, amount });
    const { route, reason } = decideSigningRoute({ walletName, force: flags.review, usdValue });
    process.stderr.write(`Signing route: ${route} — ${reason}.\n`);

    if (route === "web-app") {
      const evm = toTransactionEVM(tx, { chainIdNum: client.chain.id, from: walletAddress });
      const result = await signViaWebApp({
        address: walletAddress,
        transactions: [{ evm, label: `Send ${amount} ${resolved.symbol}` }],
        timeout,
        client,
      });
      reportHandoff(summary, result);
      return;
    }

    // Local route — unlock the keystore, sign, broadcast, wait for receipt.
    const passphrase = await requireAgentToken("for trading", walletName);
    const signedTxHex = await signAndSerialize(tx, chain, walletName, passphrase);
    const result = await broadcastAndWait(client, signedTxHex, { timeout });
    print({
      ...summary,
      signedVia: "local",
      tx: { hash: result.hash, status: result.status, blockNumber: result.blockNumber, gasUsed: result.gasUsed },
      executed: true,
    }, formatSwapQuote);
  } catch (err) {
    handleTradingError(err, "send_error");
  }
}

async function sendOnSolana({ token, amount, to, flags }) {
  const upperToken = token.toUpperCase();
  if (upperToken !== "SOL") {
    printError("solana_spl_not_supported",
      `Solana send currently supports native SOL only (got token "${token}").`,
      {
        suggestion: "For SPL tokens, use a same-chain swap into SOL first or open an issue tracking SPL send support.",
      }
    );
    process.exit(1);
  }

  const { walletName, address } = resolveWallet({ ...flags, chain: "solana" });
  if (!address) {
    printError("no_solana_account", `Wallet "${walletName}" has no Solana account.`, {
      suggestion: "Pick a mnemonic-derived wallet or one imported with --sol-key.",
    });
    process.exit(1);
  }

  const summary = {
    send: {
      token: "SOL",
      amount,
      from: address,
      to,
      chain: "solana",
      type: "native",
    },
  };

  try {
    const timeout = parseTimeout(flags.timeout);

    // Sell-side USD value drives routing (send = amount × price(SOL)). Resolve
    // SOL's fungible id best-effort; if it's unavailable the router fail-closes
    // to review when a threshold is set.
    let fungibleId = null;
    try {
      fungibleId = (await resolveToken("SOL", "solana")).fungibleId;
    } catch {
      // no id → usdValue null → router fail-closes under a threshold
    }
    const usdValue = await bundleSellUsd({ fungibleId, amount });
    const { route, reason } = decideSigningRoute({ walletName, force: flags.review, usdValue });
    process.stderr.write(`Signing route: ${route} — ${reason}.\n`);

    if (route === "web-app") {
      // Build the unsigned transfer (balance-gated) and hand it to the web app;
      // the connected Solana wallet signs and broadcasts.
      const { raw } = await buildUnsignedSolanaTransfer({ from: address, to, amountSol: amount });
      const result = await signViaWebApp({
        address,
        transactions: [{ solana: toSolanaTransaction(raw), label: `Send ${amount} SOL` }],
        timeout,
        client: solanaReceiptAdapter(),
      });
      reportHandoff(summary, result);
      return;
    }

    // Local route — unlock the keystore, sign, broadcast, confirm.
    const passphrase = await requireAgentToken("for trading", walletName);
    const result = await sendSolanaNative({
      from: address,
      to,
      amountSol: amount,
      walletName,
      passphrase,
    });

    print({
      ...summary,
      signedVia: "local",
      tx: {
        hash: result.hash,
        status: result.status,
      },
      executed: true,
    });
  } catch (err) {
    handleTradingError(err, "send_error");
  }
}

async function estimateGasWithFallback(client, account, to, data, fallback) {
  try {
    const estimate = await client.estimateGas({ account, to, data, value: 0n });
    return (estimate * 120n) / 100n; // 20% buffer
  } catch (err) {
    const msg = err.message || "";
    // If the revert reason indicates the transfer will definitely fail, abort
    if (msg.includes("exceeds balance") || msg.includes("insufficient") || msg.includes("underflow")) {
      const error = new Error(
        `Transfer would fail: ${msg.split("\n")[0]}. Check your token balance.`
      );
      error.code = "transfer_would_revert";
      error.suggestion = "Check your balance with: zerion positions";
      throw error;
    }
    process.stderr.write(
      `WARNING: Gas estimation failed (${msg.split("\n")[0]}). ` +
      `Using fallback of ${fallback}. The transaction may revert and you will lose gas fees.\n`
    );
    return fallback;
  }
}
