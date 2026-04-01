/**
 * Core swap/bridge logic — the revenue-generating pipeline.
 *
 * Flow: resolveTokens → getQuote → (simulate) → (approve) → sign → broadcast
 */

import * as api from "../api/client.js";
import { resolveToken } from "./resolve-token.js";
import { signSwapTransaction, broadcastAndWait, approveErc20 } from "./transaction.js";
import { signAndBroadcastSolana } from "../chain/solana.js";
import { isSolana } from "../chain/registry.js";
import { getConfigValue } from "../config.js";
import { NATIVE_ASSET_ADDRESS, DEFAULT_SLIPPAGE } from "../util/constants.js";

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

  // Convert amount to smallest units
  const amountInSmallestUnits = Math.floor(
    parseFloat(amount) * Math.pow(10, fromResolved.decimals)
  ).toString();

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
      `Check your balance and chain with: zerion-cli portfolio`
    );
    err.code = "no_route";
    err.suggestion = `Try: zerion-cli swap ETH USDC 0.001 --chain ${fromChain}`;
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
 */
export async function executeSwap(quote, walletName, passphrase) {
  const zerionChainId = quote.fromChain;

  // Route: Solana vs EVM
  if (isSolana(zerionChainId)) {
    return executeSolanaSwap(quote, walletName, passphrase);
  }

  return executeEvmSwap(quote, walletName, passphrase, zerionChainId);
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

async function executeEvmSwap(quote, walletName, passphrase, zerionChainId) {
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

  // 3. Broadcast and wait
  const result = await broadcastAndWait(client, signedTxHex);

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
