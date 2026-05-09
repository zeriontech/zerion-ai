/**
 * Core swap/bridge logic — the revenue-generating pipeline.
 *
 * Flow: resolveTokens → getQuote → (sign approval if needed) → sign swap → broadcast
 *
 * Talks to /swap/quotes/, the unified swap endpoint that:
 *   - accepts both EVM and Solana sources via `from=<addr>`
 *   - takes human-readable amounts (no parseUnits)
 *   - returns transaction_approve and transaction_swap fully-formed per offer
 *   - reports blocking conditions through `attributes.error.code`
 */

import { parseAbi } from "viem";
import * as api from "../api/client.js";
import { resolveToken } from "./resolve-token.js";
import {
  signSwapTransaction,
  broadcastAndWait,
  getPublicClient,
} from "./transaction.js";
import { signAndBroadcastSolana } from "../chain/solana.js";
import { isSolana } from "../chain/registry.js";
import { getConfigValue } from "../config.js";
import { DEFAULT_SLIPPAGE } from "../common/constants.js";
import { enforceExecutablePolicies } from "./guards.js";

const ERC20_ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const APPROVE_SELECTOR = "0x095ea7b3";

/**
 * Decode an ERC-20 approve(spender, amount) calldata into `{ spender, amount }`.
 * Returns null if the calldata isn't an approve() call we can parse.
 */
function decodeApproveCalldata(data) {
  if (typeof data !== "string" || !data.toLowerCase().startsWith(APPROVE_SELECTOR)) {
    return null;
  }
  const body = data.slice(APPROVE_SELECTOR.length).padEnd(64 * 2, "0");
  const spender = "0x" + body.slice(24, 64);
  const amount = BigInt("0x" + body.slice(64, 128));
  return { spender, amount };
}

/**
 * Check whether the on-chain allowance already covers the approve amount the
 * API embedded in `transaction_approve`. Returns true if the approval can be
 * skipped (allowance >= required amount).
 *
 * On any RPC failure, return false — re-approving is safer than silently
 * skipping and watching the swap revert.
 */
async function hasSufficientAllowance({ zerionChainId, approveTx, owner }) {
  const decoded = decodeApproveCalldata(approveTx.data);
  if (!decoded) return false;
  try {
    const client = await getPublicClient(zerionChainId);
    const current = await client.readContract({
      address: approveTx.to,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [owner, decoded.spender],
    });
    return current >= decoded.amount;
  } catch (err) {
    process.stderr.write(
      `Warning: on-chain allowance check failed (${err.message}). ` +
      `Submitting approval to be safe.\n`
    );
    return false;
  }
}

// Build the /swap/quotes/ params and resolve the from/to tokens once.
async function buildQuoteRequest({
  fromToken,
  toToken,
  amount,
  fromChain,
  toChain,
  walletAddress,
  outputReceiver,
  slippage,
}) {
  const [fromResolved, toResolved] = await Promise.all([
    resolveToken(fromToken, fromChain),
    resolveToken(toToken, toChain),
  ]);

  const params = {
    from: walletAddress,
    "input[chain_id]": fromChain,
    "input[fungible_id]": fromResolved.fungibleId,
    "input[amount]": amount,                // human-readable, NOT smallest units
    "output[chain_id]": toChain || fromChain,
    "output[fungible_id]": toResolved.fungibleId,
    "slippage_percent": slippage ?? getConfigValue("slippage") ?? DEFAULT_SLIPPAGE,
  };

  // The /swap/quotes/ endpoint requires `to` on every request — it used to
  // default to `from` when omitted, but the API now rejects with
  // "'to' is required". Always send it. For same-wallet bridges this is
  // the source signer's address on the destination chain (resolved by
  // resolveDestination upstream); for Solana ↔ EVM it's the user-provided
  // receiver. Receivers must be passed at the top level, NOT `output[to]`.
  params.to = outputReceiver || walletAddress;

  return { params, fromResolved, toResolved };
}

// Shape an API offer into our internal quote object. Heavy enough to share
// between single-quote selection and the offers-list view.
function offerToQuote(offer, { fromResolved, toResolved, fromChain, toChain, amount, walletAddress, outputReceiver }) {
  const attrs = offer.attributes || {};
  const blocking = attrs.error;
  return {
    id: offer.id,
    from: fromResolved,
    to: toResolved,
    inputAmount: amount,
    estimatedOutput: attrs.output_amount?.quantity,
    outputMin: attrs.minimum_output_amount?.quantity,
    estimatedSeconds: attrs.estimated_time_seconds,
    fee: {
      protocolPercent: attrs.protocol_fee?.percentage,
      protocolAmount: attrs.protocol_fee?.amount?.quantity,
      networkAmount: attrs.network_fee?.amount?.quantity,
    },
    liquiditySource: attrs.liquidity_source?.name,
    preconditions: {
      enough_balance: blocking?.code !== "not_enough_input_asset_balance",
    },
    blocking: blocking || null,
    transactionApprove: attrs.transaction_approve?.evm || null,
    transactionSwap: attrs.transaction_swap?.evm || null,
    transactionSwapSolana: attrs.transaction_swap?.solana || null,
    fromChain,
    toChain: toChain || fromChain,
    outputReceiver: outputReceiver || walletAddress,
    slippageType: attrs.slippage?.final ? "absolute" : undefined,
  };
}

function isExecutable(offer) {
  const a = offer.attributes || {};
  if (a.error) return false;
  return Boolean(a.transaction_swap?.evm || a.transaction_swap?.solana);
}

// Offer selection strategies — operate on RAW API offers (`offer.attributes…`).
//   "cheapest": highest net `output_amount` (matches API's default sort).
//   "fast":     lowest `estimated_time_seconds`. Offers with no time data
//               fall back to "cheapest" ordering.
// Both strategies prefer executable offers; non-executable offers (e.g.
// `error: not_enough_input_asset_balance`) only win when nothing else is
// available so the caller can surface the blocking error.
export function selectOffer(offers, strategy = "cheapest") {
  if (!offers.length) return null;

  const executable = offers.filter(isExecutable);
  const pool = executable.length ? executable : offers;

  if (strategy === "fast") {
    const timed = pool.filter((o) => Number.isFinite(o.attributes?.estimated_time_seconds));
    if (timed.length) {
      return timed.reduce((best, o) =>
        o.attributes.estimated_time_seconds < best.attributes.estimated_time_seconds ? o : best
      );
    }
    // No time data on any offer — fall through to cheapest.
  }

  // "cheapest" — pick max output_amount.quantity. parseFloat returns NaN for
  // non-numeric strings; treat any non-finite (NaN, Infinity, missing) as
  // ineligible so a malformed first offer can't anchor the reducer and beat
  // every later candidate.
  const numericOut = (o) => {
    const n = parseFloat(o.attributes?.output_amount?.quantity);
    return Number.isFinite(n) ? n : -Infinity;
  };
  return pool.reduce((best, o) => (numericOut(o) > numericOut(best) ? o : best));
}

// True iff the quote can be signed and broadcast: no API-side blocking
// error AND a transaction payload is present. `bridge` reuses this so the
// "executable" flag in list-mode output matches what `pickOffer` would
// actually select — otherwise a no-error/no-tx offer would render as
// `ready` and silently get skipped at execution time.
export function isQuoteExecutable(quote) {
  if (!quote || quote.blocking != null) return false;
  return Boolean(quote.transactionSwap || quote.transactionSwapSolana);
}

// Mapped-quote selection — same strategy semantics as selectOffer, but works
// on the post-`offerToQuote` shape so callers (`bridge`) don't have to refetch
// the API to get a single quote after listing offers.
//
// Selection order:
//   1. If any executable quote exists → pick from those by strategy.
//   2. Else if any blocked quote has a real API error → return the
//      highest-output one so executeSwap can surface that error message.
//   3. Else (only no-tx / no-error quotes) → return null. The caller
//      treats this as no_route, which is correct: nothing in the response
//      is signable AND nothing in the response carries actionable info.
export function pickOffer(quotes, strategy = "cheapest") {
  if (!quotes.length) return null;

  const out = (q) => {
    const n = parseFloat(q.estimatedOutput);
    return Number.isFinite(n) ? n : -Infinity;
  };

  const executable = quotes.filter(isQuoteExecutable);
  if (executable.length) {
    if (strategy === "fast") {
      const timed = executable.filter((q) => Number.isFinite(q.estimatedSeconds));
      if (timed.length) {
        return timed.reduce((best, q) => (q.estimatedSeconds < best.estimatedSeconds ? q : best));
      }
    }
    return executable.reduce((best, q) => (out(q) > out(best) ? q : best));
  }

  // No executable quotes — surface the best blocked-with-error candidate so
  // executeSwap throws a meaningful message. If even that's missing (no
  // executable AND no blocking error), there is nothing signable here and
  // the caller should treat it as a routing failure.
  const informative = quotes.filter((q) => q.blocking != null);
  if (!informative.length) return null;
  return informative.reduce((best, q) => (out(q) > out(best) ? q : best));
}

function noRouteError(amount, fromResolved, toResolved, fromChain) {
  const err = new Error(
    `No swap route found for ${amount} ${fromResolved.symbol} → ${toResolved.symbol} on ${fromChain}. ` +
    `Minimum swap is ~$1. ` +
    `Check your balance and chain with: zerion portfolio`
  );
  err.code = "no_route";
  err.suggestion = `Try a smaller amount or different pair: zerion swap ${fromChain} 0.001 ETH USDC`;
  return err;
}

/**
 * Get a single swap/bridge quote, picked by strategy ("cheapest" | "fast").
 * "cheapest" is the legacy default — matches the API's first-offer ordering
 * and never changes behavior for existing callers.
 */
export async function getSwapQuote(input) {
  const strategy = input.strategy || "cheapest";
  const { params, fromResolved, toResolved } = await buildQuoteRequest(input);
  const response = await api.getSwapQuotes(params);
  const offers = response.data || [];

  if (offers.length === 0) {
    throw noRouteError(input.amount, fromResolved, toResolved, input.fromChain);
  }

  const picked = selectOffer(offers, strategy);
  return offerToQuote(picked, {
    fromResolved,
    toResolved,
    fromChain: input.fromChain,
    toChain: input.toChain,
    amount: input.amount,
    walletAddress: input.walletAddress,
    outputReceiver: input.outputReceiver,
  });
}

/**
 * List ALL swap/bridge offers without picking one. Used by `zerion bridge`
 * (no flag) so the agent can compare providers before committing.
 */
export async function getSwapOffers(input) {
  const { params, fromResolved, toResolved } = await buildQuoteRequest(input);
  const response = await api.getSwapQuotes(params);
  const offers = response.data || [];

  if (offers.length === 0) {
    throw noRouteError(input.amount, fromResolved, toResolved, input.fromChain);
  }

  return offers.map((o) => offerToQuote(o, {
    fromResolved,
    toResolved,
    fromChain: input.fromChain,
    toChain: input.toChain,
    amount: input.amount,
    walletAddress: input.walletAddress,
    outputReceiver: input.outputReceiver,
  }));
}

/**
 * Execute a swap — sign approval (if any), sign swap, broadcast.
 * @param {object} quote
 * @param {string} walletName
 * @param {string} passphrase
 * @param {object} [options]
 * @param {number} [options.timeout] - broadcast timeout in seconds
 */
export async function executeSwap(quote, walletName, passphrase, { timeout } = {}) {
  if (quote.blocking) {
    const err = new Error(
      `Quote not executable: ${quote.blocking.message || quote.blocking.code}` +
      (quote.blocking.hint ? ` (hint: ${quote.blocking.hint})` : "")
    );
    err.code = quote.blocking.code || "quote_blocked";
    throw err;
  }

  const zerionChainId = quote.fromChain;
  const isCrossChain = quote.fromChain !== quote.toChain;

  if (isSolana(zerionChainId)) {
    if (!quote.transactionSwapSolana?.raw) {
      throw new Error("Quote did not include a Solana transaction");
    }
    return executeSolanaSwap(quote, walletName, passphrase);
  }

  if (!quote.transactionSwap) {
    throw new Error("Quote did not include an EVM transaction");
  }

  return executeEvmSwap(quote, walletName, passphrase, zerionChainId, { timeout, isCrossChain });
}

async function executeSolanaSwap(quote, walletName, passphrase) {
  // Solana txs from the swap API are base64-encoded raw transactions.
  const result = await signAndBroadcastSolana(
    quote.transactionSwapSolana,
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

  // 1. Approval if the API supplied one. /swap/quotes/ pre-builds the approve
  // tx whether or not it's actually needed — check the on-chain allowance
  // first and skip if the existing one already covers this swap.
  let approvalHash = null;
  let approvalNonce = null;
  if (quote.transactionApprove) {
    const approveTx = quote.transactionApprove;
    const owner = approveTx.from;

    const alreadyApproved = await hasSufficientAllowance({
      zerionChainId,
      approveTx,
      owner,
    });

    if (alreadyApproved) {
      process.stderr.write(`Existing allowance covers this swap — skipping approval.\n`);
    } else {
      await enforceExecutablePolicies({
        to: approveTx.to,
        value: approveTx.value || "0",
        data: approveTx.data,
      });

      process.stderr.write(`Approving ${quote.from.symbol} for swap...\n`);
      const { signedTxHex, client, tx: signedApprove } = await signSwapTransaction(
        approveTx,
        zerionChainId,
        walletName,
        passphrase
      );
      approvalNonce = signedApprove.nonce;
      const approvalResult = await broadcastAndWait(client, signedTxHex, { timeout });

      if (approvalResult.status !== "success") {
        const err = new Error(
          `ERC-20 approval failed for ${quote.from.symbol} on ${zerionChainId}. Tx: ${approvalResult.hash}`
        );
        err.code = "approval_failed";
        err.approvalHash = approvalResult.hash;
        throw err;
      }
      approvalHash = approvalResult.hash;
      process.stderr.write(`Approval confirmed: ${approvalHash}\n`);
    }
  }

  // 2. Swap tx — when we just broadcast an approval, public RPCs sometimes
  // still report the pre-approval nonce as "latest" for a few seconds. Force
  // the next nonce locally instead of trusting the node.
  const swapTx = quote.transactionSwap;
  await enforceExecutablePolicies({
    to: swapTx.to,
    value: swapTx.value || "0",
    data: swapTx.data,
  });

  const swapNonceOverride = approvalNonce != null ? approvalNonce + 1 : undefined;
  const { signedTxHex, client } = await signSwapTransaction(
    swapTx,
    zerionChainId,
    walletName,
    passphrase,
    { nonceOverride: swapNonceOverride }
  );

  // 3. Broadcast and wait for source-chain confirmation
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
      const bridgeTimeout = timeout || 300;
      const delivery = await waitForBridgeDelivery(quote, preBalance, bridgeTimeout);
      result.bridgeDelivery = delivery;
    }
  }

  return {
    ...result,
    approvalHash,
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
 *
 * Uses `only_simple` for the position filter — Solana addresses reject
 * `no_filter` ("currently not supported for solana addresses"), and we only
 * need wallet-held balances here (no DeFi positions involved in delivery
 * detection). `only_simple` works on both Solana and EVM.
 */
async function fetchTokenBalance(walletAddress, chainId, tokenSymbol) {
  const response = await api.getPositions(walletAddress, {
    chainId,
    positionFilter: "only_simple",
  });
  const upperSymbol = tokenSymbol.toUpperCase();
  const match = (response.data || []).find(
    (p) => p.attributes.fungible_info?.symbol?.toUpperCase() === upperSymbol
  );
  return match?.attributes?.quantity?.float ?? 0;
}

/**
 * Get the current balance of the destination token on the destination chain.
 * Used as a "before" snapshot to detect bridge delivery.
 *
 * Use the receiver address (output[to]) rather than the source signer — for
 * Solana↔EVM bridges these differ, and reading positions for the source
 * address on the destination chain returns nothing.
 */
async function getDestinationBalance(quote) {
  try {
    return await fetchTokenBalance(
      quote.outputReceiver,
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
 */
async function waitForBridgeDelivery(quote, preBalance, timeoutSeconds) {
  const walletAddress = quote.outputReceiver;
  if (!walletAddress) {
    return { status: "unknown", reason: "no receiver address in quote" };
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
