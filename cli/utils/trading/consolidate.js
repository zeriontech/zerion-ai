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

// Lowercase set so callers can do an O(1) `STABLE_SYMBOLS.has(sym.toLowerCase())`
// match. The literal symbol casings used by the Zerion fungibles API mix case
// (USDe, crvUSD, ...) — lowercasing the comparison side normalises that.
export const STABLE_SYMBOLS = new Set([
  "usdc",
  "usdt",
  "dai",
  "usds",
  "frax",
  "tusd",
  "usdd",
  "pyusd",
  "lusd",
  "gusd",
  "usde",
  "rlusd",
  "fdusd",
  "usdb",
  "crvusd",
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
 * Compute the sweepable native-gas amount.
 * Returns `{ amount, reason }` — `reason` is set when amount ≤ 0 so the caller
 * can mark the row `skipped: below_reserve`.
 */
export function computeNativeSweepAmount(quantity, reserve) {
  const q = Number(quantity);
  const r = Number(reserve);
  if (!Number.isFinite(q) || !Number.isFinite(r)) {
    return { amount: 0, reason: "below_reserve" };
  }
  const amount = q - r;
  if (amount <= 0) {
    return { amount: 0, reason: "below_reserve" };
  }
  return { amount, reason: null };
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
 *     minValueUsd           - dust threshold
 *
 * Returns one of:
 *   { kind: "skip", reason }            — row excluded entirely (no plan entry)
 *   { kind: "dust" }                    — emit a plan row `status: skipped, dust`
 *   { kind: "candidate", symbol, valueUsd, quantity, fungible, implAddress }
 */
export function classifyPosition(row, ctx) {
  const attrs = row?.attributes || {};
  const fungible = attrs.fungible_info || {};
  const symbol = (fungible.symbol || "").toUpperCase();
  const positionType = attrs.position_type;
  const valueUsd = Number(attrs.value);
  const quantity = Number(attrs.quantity?.float);
  const implAddress = getImplementationAddress(fungible, ctx.chain);
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

  if (!Number.isFinite(valueUsd) || valueUsd < ctx.minValueUsd) {
    return { kind: "dust", symbol, valueUsd, quantity, fungible, implAddress };
  }

  return { kind: "candidate", symbol, valueUsd, quantity, fungible, implAddress };
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
        quantity: result.quantity,
        valueUsd: result.valueUsd,
        fungible: result.fungible,
      });
      continue;
    }
    candidates.push({
      symbol: result.symbol,
      valueUsd: result.valueUsd,
      quantity: result.quantity,
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
 * Build the dry-run plan by fetching one quote per candidate sequentially.
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
  quoteFn = getSwapQuote,
}) {
  const rows = [];

  // Dust rows first so the table groups visually-skipped entries together.
  for (const d of skippedDust) {
    rows.push({
      symbol: d.symbol,
      quantity: d.quantity,
      value_usd: d.valueUsd,
      expected_output: null,
      expected_output_usd: null,
      loss_pct: null,
      status: "skipped",
      reason: "dust",
    });
  }

  for (const c of candidates) {
    // Native sweep amount uses (quantity - reserve) when the row is the chain's
    // native gas token. Non-native rows sweep the full quantity.
    let sweepQuantity = c.quantity;
    if (c.isNative) {
      const { amount, reason } = computeNativeSweepAmount(c.quantity, gasReserveValue);
      if (reason) {
        rows.push({
          symbol: c.symbol,
          quantity: c.quantity,
          value_usd: c.valueUsd,
          expected_output: null,
          expected_output_usd: null,
          loss_pct: null,
          status: "skipped",
          reason: "below_reserve",
        });
        continue;
      }
      sweepQuantity = amount;
    }

    let quote;
    try {
      quote = await quoteFn({
        fromToken: c.symbol,
        toToken,
        amount: String(sweepQuantity),
        fromChain: chain,
        toChain: chain,
        walletAddress,
        outputReceiver: walletAddress,
        slippage,
      });
    } catch (err) {
      rows.push({
        symbol: c.symbol,
        quantity: sweepQuantity,
        value_usd: c.valueUsd,
        expected_output: null,
        expected_output_usd: null,
        loss_pct: null,
        status: "no_route",
        reason: err?.message || "no route",
      });
      continue;
    }

    const evaluation = evaluateQuote({
      estimatedOutput: quote.estimatedOutput,
      targetUsdPrice,
      positionValueUsd: c.valueUsd,
      maxLoss,
    });

    if (evaluation.status === "skipped") {
      rows.push({
        symbol: c.symbol,
        quantity: sweepQuantity,
        value_usd: c.valueUsd,
        expected_output: null,
        expected_output_usd: null,
        loss_pct: null,
        status: "skipped",
        reason: evaluation.reason,
        quote,
      });
      continue;
    }
    if (evaluation.status === "blocked") {
      rows.push({
        symbol: c.symbol,
        quantity: sweepQuantity,
        value_usd: c.valueUsd,
        expected_output: evaluation.expectedOutput,
        expected_output_usd: evaluation.expectedOutputUsd,
        loss_pct: evaluation.lossPct,
        status: "blocked",
        reason: "max_loss",
        quote,
      });
      continue;
    }
    rows.push({
      symbol: c.symbol,
      quantity: sweepQuantity,
      value_usd: c.valueUsd,
      expected_output: evaluation.expectedOutput,
      expected_output_usd: evaluation.expectedOutputUsd,
      loss_pct: evaluation.lossPct,
      status: "ready",
      quote,
    });
  }

  return summarisePlan(rows, { chain, toToken, walletAddress, targetUsdPrice });
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
