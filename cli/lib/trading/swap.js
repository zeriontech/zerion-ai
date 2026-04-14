/**
 * Core swap/bridge logic — the revenue-generating pipeline.
 *
 * Flow: resolveTokens → getQuote → (simulate) → (approve) → sign → broadcast
 */

import { parseUnits } from "viem";
import * as api from "../api/client.js";
import { resolveToken } from "./resolve-token.js";
import { signSwapTransaction, broadcastAndWait, approveErc20 } from "./transaction.js";
import { signAndBroadcastSolana } from "../chain/solana.js";
import { isSolana } from "../chain/registry.js";
import { getConfigValue } from "../config.js";
import { NATIVE_ASSET_ADDRESS, DEFAULT_SLIPPAGE } from "../util/constants.js";
import { enforceExecutablePolicies } from "./guards.js";

/**
 * Get a swap/bridge quote from Zerion API.
 */
export async function getSwapQuote({
  fromToken,
  toToken,
  amount,
  fromChain,
  toChain,
  walletAddress,
  slippage,
}) {
  const [fromResolved, toResolved] = await Promise.all([
    resolveToken(fromToken, fromChain),
    resolveToken(toToken, toChain),
  ]);

  // Convert amount to smallest units using viem's parseUnits for precision
  const amountInSmallestUnits = parseUnits(amount, fromResolved.decimals).toString();

  const params = {
    "input[from]": walletAddress,
    "input[chain_id]": fromChain,
    "input[fungible_id]": fromResolved.fungibleId,
    "input[amount]": amountInSmallestUnits,
    "output[chain_id]": toChain || fromChain,
    "output[fungible_id]": toResolved.fungibleId,
    "slippage_percent": slippage || getConfigValue("slippage") || DEFAULT_SLIPPAGE,
    sort: "amount",
  };

  const response = await api.getSwapOffers(params);
  const offers = response.data || [];

  if (offers.length === 0) {
    const err = new Error(
      `No swap route found for ${amount} ${fromResolved.symbol} → ${toResolved.symbol} on ${fromChain}. ` +
      `Minimum swap is ~$1. ` +
      `Check your balance and chain with: zerion portfolio`
    );
    err.code = "no_route";
    err.suggestion = `Try: zerion swap ETH USDC 0.001 --chain ${fromChain}`;
    throw err;
  }

  const best = offers[0];
  const attrs = best.attributes;

  // Extract the chain-specific token address from the transaction data
  // The swap API tx.data often encodes the actual token address used on-chain
  // For approvals, we also get it from the transaction's input token reference
  const txData = attrs.transaction?.data || "";

  // Try to extract token address from the swap API's included relationships
  let chainTokenAddress = fromResolved.address;
  try {
    const inputFungibleId = best.relationships?.input_fungible?.data?.id;
    if (inputFungibleId) {
      const fungibleRes = await api.getFungible(inputFungibleId);
      const impl = fungibleRes?.data?.attributes?.implementations?.find(
        (i) => i.chain_id === fromChain
      );
      if (impl?.address) chainTokenAddress = impl.address;
    }
  } catch (err) {
    process.stderr.write(`Warning: fungible lookup failed, using resolved address: ${err.message}\n`);
  }

  return {
    id: best.id,
    from: {
      ...fromResolved,
      chainAddress: chainTokenAddress,
    },
    to: toResolved,
    inputAmount: amount,
    inputAmountRaw: amountInSmallestUnits,
    estimatedOutput: attrs.estimation?.output_quantity?.float,
    outputMin: attrs.output_quantity_min?.float,
    gas: attrs.estimation?.gas,
    estimatedSeconds: attrs.estimation?.seconds,
    fee: {
      protocolPercent: attrs.fee?.protocol?.percent,
      protocolAmount: attrs.fee?.protocol?.quantity?.float,
    },
    liquiditySource: attrs.liquidity_source?.name,
    preconditions: attrs.preconditions_met || {},
    spender: attrs.asset_spender,
    transaction: attrs.transaction,
    fromChain,
    toChain: toChain || fromChain,
    slippageType: attrs.slippage_type,
  };
}

/**
 * Execute a swap — handle approval if needed, sign, broadcast.
 * @param {object} quote
 * @param {string} walletName
 * @param {string} passphrase
 * @param {object} [options]
 * @param {number} [options.timeout] - broadcast timeout in seconds
 */
export async function executeSwap(quote, walletName, passphrase, { timeout } = {}) {
  const zerionChainId = quote.fromChain;
  const isCrossChain = quote.fromChain !== quote.toChain;

  // Enforce executable policies before signing
  const tx = quote.transaction || {};
  await enforceExecutablePolicies({ to: tx.to, value: tx.value, data: tx.data });

  // Route: Solana vs EVM
  if (isSolana(zerionChainId)) {
    return executeSolanaSwap(quote, walletName, passphrase);
  }

  return executeEvmSwap(quote, walletName, passphrase, zerionChainId, { timeout, isCrossChain });
}

async function executeSolanaSwap(quote, walletName, passphrase) {
  const result = await signAndBroadcastSolana(
    quote.transaction,
    walletName,
    passphrase
  );

  return {
    ...result,
    swap: {
      from: `${quote.inputAmount} ${quote.from.symbol}`,
      to: `~${quote.estimatedOutput} ${quote.to.symbol}`,
      fee: quote.fee,
      source: quote.liquiditySource,
    },
  };
}

async function executeEvmSwap(quote, walletName, passphrase, zerionChainId, { timeout, isCrossChain = false } = {}) {
  // Snapshot destination balance before bridge (for delivery detection)
  let preBalance = null;
  if (isCrossChain) {
    preBalance = await getDestinationBalance(quote);
  }

  // 1. Handle ERC-20 approval if needed
  if (
    quote.preconditions.enough_allowance === false &&
    quote.spender &&
    quote.from.chainAddress !== NATIVE_ASSET_ADDRESS
  ) {
    const tokenAddr = quote.from.chainAddress;
    const approvalAmount = BigInt(quote.inputAmountRaw);
    const approvalResult = await approveErc20(
      tokenAddr,
      quote.spender,
      approvalAmount,
      zerionChainId,
      walletName,
      passphrase
    );

    if (approvalResult.status !== "success") {
      const err = new Error(
        `ERC-20 approval failed for ${quote.from.symbol} on ${zerionChainId}. ` +
        `Token: ${tokenAddr}, Spender: ${quote.spender}. ` +
        `Tx: ${approvalResult.hash}`
      );
      err.code = "approval_failed";
      err.approvalHash = approvalResult.hash;
      throw err;
    }

    // Small delay for approval to propagate
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 2. Sign the swap transaction
  const { signedTxHex, client } = await signSwapTransaction(
    quote.transaction,
    zerionChainId,
    walletName,
    passphrase
  );

  // 3. Broadcast and wait for source chain confirmation
  const result = await broadcastAndWait(client, signedTxHex, { timeout, isCrossChain });

  // 4. For cross-chain: poll destination chain for delivery
  if (isCrossChain && result.status === "success") {
    if (preBalance === null) {
      result.bridgeDelivery = {
        status: "unknown",
        reason: "Could not snapshot destination balance before bridge. Check manually.",
        suggestion: `zerion positions --chain ${quote.toChain}`,
      };
    } else {
      const bridgeTimeout = timeout || 300; // 5 min default for bridge delivery
      const delivery = await waitForBridgeDelivery(quote, preBalance, bridgeTimeout);
      result.bridgeDelivery = delivery;
    }
  }

  return {
    ...result,
    swap: {
      from: `${quote.inputAmount} ${quote.from.symbol}`,
      to: `~${quote.estimatedOutput} ${quote.to.symbol}`,
      fee: quote.fee,
      source: quote.liquiditySource,
    },
  };
}

/**
 * Fetch the balance of a token on a specific chain for a wallet address.
 * Returns 0 if the token is not found or the API call fails.
 */
async function fetchTokenBalance(walletAddress, chainId, tokenSymbol) {
  const response = await api.getPositions(walletAddress, { chainId });
  const upperSymbol = tokenSymbol.toUpperCase();
  const match = (response.data || []).find(
    (p) => p.attributes.fungible_info?.symbol?.toUpperCase() === upperSymbol
  );
  return match?.attributes?.quantity?.float ?? 0;
}

/**
 * Get the current balance of the destination token on the destination chain.
 * Used as a "before" snapshot to detect bridge delivery.
 */
async function getDestinationBalance(quote) {
  try {
    return await fetchTokenBalance(
      quote.transaction?.from || "",
      quote.toChain,
      quote.to.symbol
    );
  } catch (err) {
    process.stderr.write(
      `Warning: could not snapshot destination balance (${err.message}). ` +
      `Bridge delivery detection may be inaccurate.\n`
    );
    return null;
  }
}

/**
 * Poll destination chain balance until it increases (bridge delivery) or timeout.
 *
 * Strategy: the quote includes `estimatedSeconds` from the bridge provider.
 * We wait for that duration first (no point polling before the relay is expected),
 * then poll every 10s. If no estimate, start polling after 10s.
 */
async function waitForBridgeDelivery(quote, preBalance, timeoutSeconds) {
  const walletAddress = quote.transaction?.from;
  if (!walletAddress) {
    return { status: "unknown", reason: "no wallet address in quote" };
  }

  const estimatedWait = quote.estimatedSeconds || 0;
  const initialDelay = Math.min(Math.max(estimatedWait, 10), timeoutSeconds / 2);
  const pollInterval = 10_000;
  const { toChain } = quote;
  const tokenSymbol = quote.to.symbol;

  process.stderr.write(
    `Waiting for bridge delivery on ${toChain}` +
    (estimatedWait ? ` (estimated ${estimatedWait}s)` : "") +
    `, timeout ${timeoutSeconds}s...\n`
  );

  process.stderr.write(`Waiting ${initialDelay}s for relay before checking...\n`);
  await new Promise((r) => setTimeout(r, initialDelay * 1000));

  const deadline = Date.now() + (timeoutSeconds - initialDelay) * 1000;
  let polls = 0;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    polls++;

    try {
      const currentBalance = await fetchTokenBalance(walletAddress, toChain, tokenSymbol);
      consecutiveErrors = 0;

      // Use epsilon to avoid floating-point false positives/negatives
      const EPSILON = 1e-9;
      if (currentBalance - preBalance > EPSILON) {
        const received = currentBalance - preBalance;
        process.stderr.write(
          `Bridge delivery confirmed: +${received.toFixed(6)} ${tokenSymbol} on ${toChain}\n`
        );
        return { status: "delivered", received, destinationChain: toChain, token: tokenSymbol, polls };
      }

      process.stderr.write(`Poll ${polls}: no change yet on ${toChain}...\n`);
    } catch (err) {
      consecutiveErrors++;
      process.stderr.write(`Poll ${polls}: API error (${err.message}), retrying...\n`);
      if (consecutiveErrors >= 5) {
        process.stderr.write("Too many consecutive API errors. Giving up on delivery detection.\n");
        return {
          status: "error",
          reason: `${consecutiveErrors} consecutive API failures`,
          lastError: err.message,
          suggestion: `zerion positions --chain ${toChain}`,
        };
      }
    }

    if (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  process.stderr.write(
    `Bridge delivery not confirmed within ${timeoutSeconds}s. ` +
    `Funds may still arrive — check with: zerion positions --chain ${toChain}\n`
  );
  return {
    status: "timeout",
    destinationChain: toChain,
    token: tokenSymbol,
    polls,
    suggestion: `zerion positions --chain ${toChain}`,
  };
}
