/**
 * Pure logic for `zerion consolidate` — filtering, gas-reserve math, loss
 * evaluation, and dry-run plan assembly. The CLI shell in
 * `cli/commands/trading/consolidate.js` handles flag parsing, the stables
 * prompt, target-token resolution, and the `--execute` broadcast loop;
 * everything testable without network mocks lives here.
 *
 * Quotes are fetched sequentially via the shared `getSwapQuote` to stay under
 * the Zerion API rate limit.
 */

import { getSwapQuote } from "./swap.js";
import { getPublicClient } from "./transaction.js";
import { isSolana } from "../chain/registry.js";

// Lowercase set so callers can do an O(1) `STABLE_SYMBOLS.has(sym.toLowerCase())`
// match. The literal symbol casings used by the Zerion fungibles API mix case
// (USDe, crvUSD, ...) — lowercasing the comparison side normalises that.
export const STABLE_SYMBOLS = new Set([
  "usdc",
  "usdt",
  "usdc.e",  // bridged USDC (e.g. polygon, arbitrum, optimism) — treated as USDC for filter purposes
  "usdt0",   // LayerZero-bridged USDT (e.g. base)
  "usds",    // Sky / Maker rebrand of DAI
  "tusd",
  "usde",    // Ethena
]);

export function isStable(symbol) {
  if (!symbol) return false;
  return STABLE_SYMBOLS.has(String(symbol).toLowerCase());
}

// Per-chain native gas reserve when `--include-native` is passed without an
// explicit `--gas-reserve`. Keys match Zerion chain ids. Unknown chains fall
// through to FALLBACK_GAS_RESERVE with a stderr warning surfaced by the CLI.
export const DEFAULT_GAS_RESERVES = {
  ethereum: 0.005,
  base: 0.001,
  arbitrum: 0.001,
  optimism: 0.001,
  polygon: 1,
  "binance-smart-chain": 0.005,
  avalanche: 0.05,
  gnosis: 1,
  scroll: 0.001,
  linea: 0.001,
  "zksync-era": 0.001,
  zora: 0.001,
  blast: 0.001,
  solana: 0.01,
};

export const FALLBACK_GAS_RESERVE = 0.01;

/**
 * Look up the default gas reserve for a chain. Returns
 * `{ value, isDefault, isFallback }` so the CLI can surface a stderr warning
 * when it falls back to the conservative default.
 */
export function resolveGasReserve(chainId, explicit) {
  if (explicit !== undefined && explicit !== null) {
    return { value: explicit, isDefault: false, isFallback: false };
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_GAS_RESERVES, chainId)) {
    return { value: DEFAULT_GAS_RESERVES[chainId], isDefault: true, isFallback: false };
  }
  return { value: FALLBACK_GAS_RESERVE, isDefault: true, isFallback: true };
}

/**
 * Parse `--max-loss` with the dual-form rule:
 *   - value > 1     → percent (e.g. `5` → 0.05)
 *   - value ≤ 1     → fraction (e.g. `0.05` → 0.05)
 *
 * Rejects NaN, negative, or > 100. Returns the fraction.
 * Throws `{ code: "invalid_max_loss", message }` on bad input so the caller
 * can surface a `printError` consistently.
 */
export function parseMaxLoss(raw) {
  if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) {
    // Default = 5% — apply the same dual-form rule (5 > 1 → percent).
    return 0.05;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    const err = new Error(
      `Invalid --max-loss: ${raw}. Must be a non-negative number ≤ 100. ` +
      `Pass either a percent ("5") or a fraction ("0.05") — values > 1 are treated as percent.`,
    );
    err.code = "invalid_max_loss";
    throw err;
  }
  return n > 1 ? n / 100 : n;
}

/**
 * Parse `--min-value` (USD). Returns a non-negative number; defaults to 1.
 * Throws `{ code: "invalid_min_value" }` on bad input.
 */
export function parseMinValue(raw) {
  if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) {
    return 1;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`Invalid --min-value: ${raw}. Must be a non-negative number.`);
    err.code = "invalid_min_value";
    throw err;
  }
  return n;
}

/**
 * Parse `--max-value` (USD). Returns a positive number, or `Infinity` when
 * the flag is unset (no upper bound). Combined with `--min-value`, expresses
 * a band: positions with `value ∈ [min, max]` are sweep candidates; below
 * `min` is dust, above `max` is "main holdings" (skipped, surfaced).
 *
 * Throws `{ code: "invalid_max_value" }` on bad input.
 */
export function parseMaxValue(raw) {
  if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) {
    return Infinity;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`Invalid --max-value: ${raw}. Must be a positive number.`);
    err.code = "invalid_max_value";
    throw err;
  }
  return n;
}

/**
 * Parse `--concurrency` (positive integer in `[1, 10]`). Returns `undefined`
 * when the flag isn't set so the CLI can auto-pick by API-key tier. Throws
 * `{ code: "invalid_concurrency" }` on NaN, negative, zero, > 10, or
 * non-integer input.
 *
 * The upper bound is a defensive ceiling: even on paid keys, more than 10
 * in-flight quotes risks tripping per-IP rate limits and hides scaling bugs
 * (e.g. /chains/ catalog cache races) behind a "looks fast" surface.
 */
export function parseConcurrency(raw) {
  if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) {
    return undefined;
  }
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  const n = typeof trimmed === "number" ? trimmed : Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 10) {
    const err = new Error(
      `Invalid --concurrency: ${raw}. Must be an integer between 1 and 10.`,
    );
    err.code = "invalid_concurrency";
    throw err;
  }
  return n;
}

/**
 * Parse `--gas-reserve` (native units). Returns a non-negative number or
 * `undefined` if the flag isn't set. Throws `{ code: "invalid_gas_reserve" }`
 * on bad input.
 */
export function parseGasReserve(raw) {
  if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) {
    return undefined;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`Invalid --gas-reserve: ${raw}. Must be a non-negative number.`);
    err.code = "invalid_gas_reserve";
    throw err;
  }
  return n;
}

/**
 * Normalise a comma-separated symbol list flag into an upper-case Set.
 * Empty / undefined → empty Set. Whitespace around symbols is trimmed.
 */
export function parseSymbolList(raw) {
  if (!raw || raw === true) return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

/**
 * Convert a raw on-chain quantity (string of wei / smallest-units) into a
 * precise decimal string. Avoids the precision loss `Number(quantity.float)`
 * would suffer on 18-decimal balances above ~15 significant digits, which
 * the swap API then over-reconstructs into wei and rejects with
 * "Input asset balance is not enough."
 *
 * Inputs:
 *   - `intStr`:  string of the smallest-units integer (e.g. "1234567890123456789")
 *   - `decimals`: number of fractional decimals (e.g. 18 for ETH/ERC-20 18-dp)
 *
 * Returns a canonical decimal string with trailing zeros stripped:
 *   rawWeiToDecimalString("1234567890123456789", 18) → "1.234567890123456789"
 *   rawWeiToDecimalString("1000000000000000000", 18) → "1"
 *   rawWeiToDecimalString("100000", 6)               → "0.1"
 *   rawWeiToDecimalString("0", 18)                   → "0"
 */
export function rawWeiToDecimalString(intStr, decimals) {
  const big = BigInt(intStr);
  if (decimals === 0) return big.toString();
  const div = 10n ** BigInt(decimals);
  const whole = big / div;
  const frac = big % div;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Compute the sweepable native-gas amount in BigInt to avoid float precision
 * loss. `quantityIntWei` is the position's raw smallest-units quantity string,
 * `reserveHumanReadable` is the user-typed `--gas-reserve` number (or
 * per-chain default), `decimals` is the chain's native decimals.
 *
 * Returns `{ amount, reason }`. `amount` is a decimal string (e.g. "0.004")
 * suitable for the swap endpoint's `input[amount]` field; `reason` is set
 * to "below_reserve" when reserve ≥ quantity (or the inputs are unusable).
 *
 * The float→wei conversion of `reserveHumanReadable` is the one place we
 * tolerate Number arithmetic: the user types these values directly (e.g.
 * `--gas-reserve 0.001`), and they're well below the 15-sigfig precision
 * ceiling. Math.floor() rounds towards zero so we never reserve LESS than
 * the operator asked for.
 */
export function computeNativeSweepAmount(quantityIntWei, reserveHumanReadable, decimals = 18) {
  if (quantityIntWei == null || reserveHumanReadable == null) {
    return { amount: "0", reason: "below_reserve" };
  }
  let qBig;
  try {
    qBig = BigInt(String(quantityIntWei));
  } catch {
    return { amount: "0", reason: "below_reserve" };
  }
  const reserveNum = Number(reserveHumanReadable);
  if (!Number.isFinite(reserveNum) || reserveNum < 0) {
    return { amount: "0", reason: "below_reserve" };
  }
  const reserveWei = BigInt(Math.floor(reserveNum * 10 ** decimals));
  if (qBig <= reserveWei) {
    return { amount: "0", reason: "below_reserve" };
  }
  const amountWei = qBig - reserveWei;
  return { amount: rawWeiToDecimalString(amountWei.toString(), decimals), reason: null };
}

/**
 * Pick the on-chain address (lowercased) for a fungible on a given chain by
 * scanning `attributes.implementations[]`. Returns `null` when the fungible
 * has no implementation for that chain (e.g. the native gas token, which is
 * symbol-only on most chains).
 */
export function getImplementationAddress(fungibleInfo, chainId) {
  const impls = fungibleInfo?.implementations || [];
  const match = impls.find((i) => i?.chain_id === chainId);
  if (!match?.address) return null;
  return String(match.address).toLowerCase();
}

/**
 * Pick the impl entry (including `decimals`) for a fungible on the given
 * chain. Returns `null` if no matching impl exists.
 */
export function getImplementation(fungibleInfo, chainId) {
  const impls = fungibleInfo?.implementations || [];
  return impls.find((i) => i?.chain_id === chainId) || null;
}

/**
 * Decide whether a single position row is a sweep candidate.
 *
 * Inputs:
 *   row: a `data[]` element from `getPositions` (full JSON:API shape).
 *   ctx:
 *     chain                 - the consolidate chain id
 *     targetSymbol          - upper-case target token symbol
 *     targetAddress         - lowercased target on-chain address for `chain`, or null
 *     nativeSymbol          - upper-case native gas token symbol, or null
 *     includeNative         - boolean
 *     includeStables        - boolean
 *     includeSet            - Set of upper-case symbols to force-include (overrides
 *                             native/stables exclusions; still subject to dust filter)
 *     excludeSet            - Set of upper-case symbols to force-exclude
 *     minValueUsd           - inclusive lower bound; rows below are dust
 *     maxValueUsd           - inclusive upper bound; rows above are "main
 *                             holdings" (skipped, surfaced). `Infinity` =
 *                             no cap (the default).
 *
 * Returns one of:
 *   { kind: "skip", reason }            — row excluded entirely (no plan entry)
 *   { kind: "dust", reason }            — emit a plan row `status: skipped`.
 *                                          `reason` is "dust" (below min) or
 *                                          "above_max" (above max).
 *   { kind: "candidate", symbol, valueUsd, quantity, fungible, implAddress }
 */
export function classifyPosition(row, ctx) {
  const attrs = row?.attributes || {};
  const fungible = attrs.fungible_info || {};
  const symbol = (fungible.symbol || "").toUpperCase();
  const positionType = attrs.position_type;
  const valueUsd = Number(attrs.value);
  const quantityFloat = Number(attrs.quantity?.float);
  const impl = getImplementation(fungible, ctx.chain);
  const implAddress = impl?.address ? String(impl.address).toLowerCase() : null;
  const decimals = impl?.decimals;
  // Precise decimal string for the swap-amount field. Convert from the raw
  // `quantity.int` (smallest units) using the chain-specific decimals so we
  // never feed a lossy Number into the API. When inputs are missing, fall
  // back to the float so we degrade rather than crash; the dust-filter will
  // still classify these correctly.
  const rawInt = attrs.quantity?.int;
  let quantity;
  if (rawInt != null && Number.isFinite(decimals)) {
    try {
      quantity = rawWeiToDecimalString(String(rawInt), Number(decimals));
    } catch {
      quantity = Number.isFinite(quantityFloat) ? String(quantityFloat) : "0";
    }
  } else if (Number.isFinite(quantityFloat)) {
    quantity = String(quantityFloat);
  } else {
    quantity = "0";
  }
  const forceInclude = ctx.includeSet.has(symbol);

  // Non-wallet positions never sweep — skip entirely, no plan row.
  if (positionType !== "wallet") {
    return { kind: "skip", reason: "non_wallet" };
  }

  // Target token — exclude by symbol OR by on-chain address (when both sides
  // expose an impl for this chain). `--include` does NOT override the target
  // exclusion — converting the target into itself is nonsense.
  if (symbol === ctx.targetSymbol) {
    return { kind: "skip", reason: "is_target" };
  }
  if (ctx.targetAddress && implAddress && implAddress === ctx.targetAddress) {
    return { kind: "skip", reason: "is_target" };
  }

  if (ctx.excludeSet.has(symbol)) {
    return { kind: "skip", reason: "excluded" };
  }

  // Native gas token — opt-in via --include-native or explicit --include.
  if (ctx.nativeSymbol && symbol === ctx.nativeSymbol) {
    if (!ctx.includeNative && !forceInclude) {
      return { kind: "skip", reason: "native_excluded" };
    }
  }

  // Stables — flag → prompt → non-TTY default exclude. The caller resolves the
  // boolean before calling us; we just honor it. `--include` still wins.
  if (!ctx.includeStables && !forceInclude && isStable(symbol)) {
    return { kind: "skip", reason: "stable_excluded" };
  }

  // Dust uses `value` (USD), not `quantity` — fine in float because USD
  // values are small-magnitude numbers. NaN/missing values fail closed as
  // dust so the row is surfaced rather than silently swept.
  if (!Number.isFinite(valueUsd) || valueUsd < ctx.minValueUsd) {
    return { kind: "dust", reason: "dust", symbol, valueUsd, quantity, quantityFloat, fungible, implAddress, decimals, rawInt };
  }

  // Above the upper bound — likely a main holding the operator doesn't want
  // to sweep. Surfaced (not silently dropped) so the operator sees what got
  // filtered. `maxValueUsd === Infinity` when --max-value isn't set, so this
  // branch is a no-op by default.
  if (Number.isFinite(ctx.maxValueUsd) && valueUsd > ctx.maxValueUsd) {
    return { kind: "dust", reason: "above_max", symbol, valueUsd, quantity, quantityFloat, fungible, implAddress, decimals, rawInt };
  }

  return { kind: "candidate", symbol, valueUsd, quantity, quantityFloat, fungible, implAddress, decimals, rawInt };
}

/**
 * Apply `classifyPosition` to the full positions array. Returns:
 *   {
 *     candidates: Array<{symbol, valueUsd, quantity, fungible, implAddress, isNative}>,
 *     skippedDust: Array<{symbol, quantity, valueUsd, fungible}>,
 *   }
 *
 * Skipped non-wallet / target / native-excluded / stable-excluded / excluded
 * rows are dropped silently — they don't appear in the plan.
 */
export function filterCandidates(positions, ctx) {
  const candidates = [];
  const skippedDust = [];
  for (const row of positions || []) {
    const result = classifyPosition(row, ctx);
    if (result.kind === "skip") continue;
    if (result.kind === "dust") {
      skippedDust.push({
        symbol: result.symbol,
        reason: result.reason,
        quantity: result.quantity,
        quantityFloat: result.quantityFloat,
        valueUsd: result.valueUsd,
        fungible: result.fungible,
      });
      continue;
    }
    candidates.push({
      symbol: result.symbol,
      valueUsd: result.valueUsd,
      quantity: result.quantity,           // precise decimal string for the swap amount
      quantityFloat: result.quantityFloat, // lossy Number for display only
      rawInt: result.rawInt,               // raw smallest-units string (used by native sweep math)
      decimals: result.decimals,
      fungible: result.fungible,
      implAddress: result.implAddress,
      isNative: ctx.nativeSymbol && result.symbol === ctx.nativeSymbol,
    });
  }
  return { candidates, skippedDust };
}

/**
 * Evaluate a quote against the loss filter.
 *
 *   loss_pct = 1 - (estimatedOutput * targetUsdPrice / positionValueUsd)
 *
 * Float-equality at exactly max_loss must be accepted — use the documented
 * 1e-9 tolerance to avoid flakes around things like `0.05 + 1e-17`.
 *
 * Returns:
 *   { status: "ready", lossPct, expectedOutput, expectedOutputUsd }
 *   { status: "blocked", reason: "max_loss", lossPct, expectedOutput, expectedOutputUsd }
 *   { status: "skipped", reason: "no_price" }    — missing inputs we can't divide
 */
export function evaluateQuote({ estimatedOutput, targetUsdPrice, positionValueUsd, maxLoss }) {
  // Treat null/undefined/empty-string as "missing" up-front — `Number(null)`
  // is 0 (finite), which would otherwise compute a 100%-loss row and surface
  // as `blocked` instead of `skipped: no_price`.
  if (
    estimatedOutput == null || estimatedOutput === "" ||
    targetUsdPrice == null || targetUsdPrice === "" ||
    positionValueUsd == null || positionValueUsd === ""
  ) {
    return { status: "skipped", reason: "no_price" };
  }
  const out = Number(estimatedOutput);
  const price = Number(targetUsdPrice);
  const posValue = Number(positionValueUsd);
  if (!Number.isFinite(out) || !Number.isFinite(price) || !Number.isFinite(posValue) || posValue <= 0) {
    return { status: "skipped", reason: "no_price" };
  }
  const expectedOutputUsd = out * price;
  const lossPct = 1 - expectedOutputUsd / posValue;
  if (lossPct > maxLoss + 1e-9) {
    return {
      status: "blocked",
      reason: "max_loss",
      lossPct,
      expectedOutput: out,
      expectedOutputUsd,
    };
  }
  return {
    status: "ready",
    lossPct,
    expectedOutput: out,
    expectedOutputUsd,
  };
}

/**
 * Build a single plan row for one candidate. Pure of order — safe to run in
 * parallel because each call only touches its own candidate. Errors thrown
 * by `quoteFn` are caught and folded into the row as `status: "no_route"`,
 * so callers don't need a try/catch around this.
 */
async function buildCandidateRow(c, ctx) {
  // Native sweep amount uses (quantity - reserve) computed in BigInt to avoid
  // float precision loss on 18-decimal balances. Non-native rows sweep the
  // full precise `quantity` string carried through from classifyPosition.
  //
  // `sweepAmount` is the string we send to the quote API. `displayQuantity`
  // is the Number we put in the printable row for the formatter (which
  // already calls toFixed(6) on it).
  let sweepAmount;
  let displayQuantity;
  if (c.isNative) {
    const { amount, reason } = computeNativeSweepAmount(
      c.rawInt,
      ctx.gasReserveValue,
      Number.isFinite(c.decimals) ? c.decimals : 18,
    );
    if (reason) {
      return {
        symbol: c.symbol,
        quantity: c.quantityFloat,
        value_usd: c.valueUsd,
        expected_output: null,
        expected_output_usd: null,
        loss_pct: null,
        status: "skipped",
        reason: "below_reserve",
      };
    }
    sweepAmount = amount;
    displayQuantity = parseFloat(amount);
  } else {
    sweepAmount = c.quantity;
    displayQuantity = Number.isFinite(c.quantityFloat) ? c.quantityFloat : parseFloat(sweepAmount);
  }

  let quote;
  try {
    quote = await ctx.quoteFn({
      fromToken: c.symbol,
      toToken: ctx.toToken,
      amount: sweepAmount,
      fromChain: ctx.chain,
      toChain: ctx.chain,
      walletAddress: ctx.walletAddress,
      outputReceiver: ctx.walletAddress,
      slippage: ctx.slippage,
    });
  } catch (err) {
    return {
      symbol: c.symbol,
      quantity: displayQuantity,
      value_usd: c.valueUsd,
      expected_output: null,
      expected_output_usd: null,
      loss_pct: null,
      status: "no_route",
      reason: err?.message || "no route",
    };
  }

  const evaluation = evaluateQuote({
    estimatedOutput: quote.estimatedOutput,
    targetUsdPrice: ctx.targetUsdPrice,
    positionValueUsd: c.valueUsd,
    maxLoss: ctx.maxLoss,
  });

  if (evaluation.status === "skipped") {
    return {
      symbol: c.symbol,
      quantity: displayQuantity,
      value_usd: c.valueUsd,
      expected_output: null,
      expected_output_usd: null,
      loss_pct: null,
      status: "skipped",
      reason: evaluation.reason,
      quote,
    };
  }
  if (evaluation.status === "blocked") {
    return {
      symbol: c.symbol,
      quantity: displayQuantity,
      value_usd: c.valueUsd,
      expected_output: evaluation.expectedOutput,
      expected_output_usd: evaluation.expectedOutputUsd,
      loss_pct: evaluation.lossPct,
      status: "blocked",
      reason: "max_loss",
      quote,
    };
  }
  return {
    symbol: c.symbol,
    quantity: displayQuantity,
    value_usd: c.valueUsd,
    expected_output: evaluation.expectedOutput,
    expected_output_usd: evaluation.expectedOutputUsd,
    loss_pct: evaluation.lossPct,
    status: "ready",
    quote,
  };
}

/**
 * Worker-pool runner. Spawns up to `concurrency` workers that pull items off
 * a shared index counter; each worker writes the result to `results[i]` so
 * the final array preserves the input order. Bounded in-flight count is
 * exactly `concurrency` — no batching artefacts where one slow item holds up
 * the next batch.
 *
 * The pool degenerates to a strict sequential `for await` loop when
 * `concurrency <= 1`, so callers that want deterministic in-order quote
 * fetches (dev-tier API keys, the existing in-order test) get the original
 * behaviour exactly.
 */
async function runWithConcurrency(items, concurrency, work) {
  const n = items.length;
  const results = new Array(n);
  const limit = Math.max(1, Math.floor(concurrency) || 1);

  if (limit === 1 || n <= 1) {
    for (let i = 0; i < n; i++) {
      results[i] = await work(items[i], i);
    }
    return results;
  }

  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= n) return;
      results[idx] = await work(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, n) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Build the dry-run plan by fetching quotes for each candidate. Concurrency
 * defaults to `1` (strictly sequential, preserves rate-limit-safe behaviour
 * on dev API keys). With `concurrency > 1`, quotes fan out via a bounded
 * worker pool; the resulting `rows` array still preserves the candidate
 * order so plan output is deterministic.
 *
 * `quoteFn` is injected so tests can drive the loop without network mocks.
 * Defaults to `getSwapQuote` from the shared swap utils.
 *
 * The returned plan is a structured object suitable for `print(..., formatter)`.
 */
export async function buildConsolidatePlan({
  candidates,
  skippedDust,
  chain,
  toToken,
  targetUsdPrice,
  walletAddress,
  slippage,
  gasReserveValue,
  maxLoss,
  concurrency = 1,
  quoteFn = getSwapQuote,
}) {
  const rows = [];

  // Value-filtered rows first so the table groups visually-skipped entries
  // together. `reason` is "dust" for below-min or "above_max" for the
  // optional upper-bound filter.
  for (const d of skippedDust) {
    rows.push({
      symbol: d.symbol,
      quantity: Number.isFinite(d.quantityFloat) ? d.quantityFloat : parseFloat(d.quantity),
      value_usd: d.valueUsd,
      expected_output: null,
      expected_output_usd: null,
      loss_pct: null,
      status: "skipped",
      reason: d.reason || "dust",
    });
  }

  const ctx = {
    chain,
    toToken,
    targetUsdPrice,
    walletAddress,
    slippage,
    gasReserveValue,
    maxLoss,
    quoteFn,
  };

  const candidateRows = await runWithConcurrency(candidates, concurrency, (c) => buildCandidateRow(c, ctx));
  rows.push(...candidateRows);

  const plan = summarisePlan(rows, { chain, toToken, walletAddress, targetUsdPrice });
  plan.concurrency = Math.max(1, Math.floor(concurrency) || 1);
  return plan;
}

/**
 * Broadcast each ready row sequentially via the injected `executeFn`. Partial
 * success is the only mode — per-row failures are appended to `results` with
 * a `failed` status and the full error string, and the loop continues. Each
 * swap is an independent on-chain transaction; one failing quote should not
 * gate the rest of a sweep.
 *
 * On EVM chains the helper tracks an externally-managed nonce counter across
 * the batch and feeds it to `executeFn` as `approvalNonceOverride`. Without
 * this, back-to-back approvals read RPC `latest` and can collide on the
 * previous tx's pending nonce, surfacing as `nonce too low` on row K+1.
 *
 * `executeFn(quote, walletName, passphrase, { timeout, approvalNonceOverride })`
 * matches the `executeSwap` signature so the CLI passes it through unwrapped.
 * Tests inject a fake (and optionally `clientFactory`) to drive scenarios
 * without touching the keystore or RPC.
 *
 * Returns `{ results, summary: { succeeded, failed } }`. The caller is
 * responsible for echoing this to stdout via `print(..., formatConsolidateResult)`.
 */
export async function executeReadyRows(
  readyRows,
  executeFn,
  { walletName, passphrase, timeout, walletAddress, chain, clientFactory = getPublicClient } = {},
) {
  const results = [];
  let succeeded = 0;
  let failed = 0;

  // Solana has no EVM-style nonce, and we don't manage Solana nonces from the
  // consolidate side. Skip the override path entirely there; the executor
  // ignores `approvalNonceOverride` for Solana rows anyway, but skipping the
  // public-client setup keeps test fixtures simple.
  const useNonceTracking = Boolean(chain) && !isSolana(chain) && Boolean(walletAddress);

  let nextNonce = null;
  let client = null;
  if (useNonceTracking) {
    try {
      client = await clientFactory(chain);
      nextNonce = Number(
        await client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
      );
    } catch (err) {
      // If we can't read the starting nonce, fall back to the no-override
      // path — each row will use RPC `latest` like the single-swap flow.
      // Surface the warning so an operator running with --pretty can see it.
      process.stderr.write(
        `Warning: could not read starting nonce for batch (${err?.message || err}). ` +
        `Falling back to per-row RPC nonce — back-to-back approvals may collide.\n`,
      );
      nextNonce = null;
    }
  }

  for (const row of readyRows) {
    const opts = { timeout };
    if (nextNonce != null) opts.approvalNonceOverride = nextNonce;

    try {
      const result = await executeFn(row.quote, walletName, passphrase, opts);
      results.push({
        symbol: row.symbol,
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      });
      if (result.status === "success") succeeded++;
      else failed++;
      // Advance the nonce: approval-sent → +2 (approval + swap), approval-
      // skipped → +1 (swap only). `result.approvalHash` is null/absent when
      // the on-chain allowance already covered the swap (see executeEvmSwap).
      if (nextNonce != null) {
        nextNonce += result.approvalHash ? 2 : 1;
      }
    } catch (err) {
      failed++;
      results.push({
        symbol: row.symbol,
        hash: null,
        status: "failed",
        error: err?.message || String(err),
      });
      // Recovery: we don't know how far into the approve/swap pair we got
      // before the throw, and `pending` may transiently include the failed
      // submission for several seconds. Invalidate the tracked counter so
      // the next row falls back to RPC `latest` via the signer's default —
      // we lose per-row batch protection for one row, but we don't compound
      // a wrong counter across the rest of the batch.
      nextNonce = null;
    }
  }
  return { results, summary: { succeeded, failed } };
}

/**
 * Roll up the plan rows into the printable structure (totals + counts).
 * Kept separate so tests can assemble rows manually and exercise totals.
 */
export function summarisePlan(rows, { chain, toToken, walletAddress, targetUsdPrice }) {
  let ready = 0;
  let blocked = 0;
  let skipped = 0;
  let noRoute = 0;
  let expectedOutputTotal = 0;

  for (const r of rows) {
    if (r.status === "ready") {
      ready++;
      if (Number.isFinite(r.expected_output)) expectedOutputTotal += r.expected_output;
    } else if (r.status === "blocked") {
      blocked++;
    } else if (r.status === "no_route") {
      noRoute++;
    } else {
      skipped++;
    }
  }

  return {
    chain,
    toToken,
    walletAddress,
    targetUsdPrice,
    rows,
    totals: {
      ready,
      blocked,
      skipped,
      no_route: noRoute,
      expected_output: expectedOutputTotal,
      expected_output_usd: Number.isFinite(targetUsdPrice) ? expectedOutputTotal * targetUsdPrice : null,
    },
    executed: false,
  };
}
