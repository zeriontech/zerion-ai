/**
 * Sweep all wallet positions on one chain into a single target token.
 *
 * Usage: zerion consolidate <chain> <to-token> [--execute] [...flags]
 *
 * Default mode is dry-run — list a plan and exit without signing. Pass
 * `--execute` to fetch fresh quotes and broadcast each ready row sequentially.
 *
 * Architecture: this file is the CLI shell — arg parsing, validation, prompts,
 * and the broadcast loop. All pure logic (filter / evaluate / gas-reserve math
 * / loss math) lives in `cli/utils/trading/consolidate.js` so it can be unit
 * tested without network mocks.
 */

import * as api from "../../utils/api/client.js";
import { getApiKeyTier } from "../../utils/api/auth.js";
import { executeSwap } from "../../utils/trading/swap.js";
import {
  requireAgentToken,
  parseTimeout,
  parseSlippage,
  handleTradingError,
} from "../../utils/trading/guards.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";
import { print, printError } from "../../utils/common/output.js";
import { confirm } from "../../utils/common/prompt.js";
import { getNativeFungible } from "../../utils/chain/catalog.js";
import { formatConsolidatePlan, formatConsolidateResult } from "../../utils/common/format.js";
import {
  filterCandidates,
  buildConsolidatePlan,
  executeReadyRows,
  resolveGasReserve,
  parseMaxLoss,
  parseMinValue,
  parseMaxValue,
  parseGasReserve,
  parseConcurrency,
  parseSymbolList,
} from "../../utils/trading/consolidate.js";
import { resolveTargetToken } from "../../utils/trading/consolidate-targets.js";

// Auto-pick the plan-phase quote concurrency from the API-key tier when the
// user didn't pass --concurrency. Paid keys can comfortably handle a small
// bounded parallel pool; dev / unknown keys stay sequential to respect the
// 120 req/min limit and avoid burst-tripping the 5K/day quota during a sweep
// of a wallet with many positions.
const AUTO_CONCURRENCY_BY_TIER = {
  paid: 5,
  dev: 1,
  unknown: 1,
};

// Mirrors `coerceBoolFlag` in cli/commands/trading/bridge.js (lines 55-64).
// parseFlags consumes the next non-`--` token as the value, so a bare boolean
// flag followed by a positional silently gets that positional as its value
// (e.g. `--include-stables ethereum` would set `include-stables="ethereum"`).
// Reject anything but true / "true" / false / "false" / undefined.
function coerceBoolFlag(value, name) {
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  printError(
    "invalid_flag_value",
    `--${name} does not take a value (got "${value}"). Pass --${name} on its own at the end of the command, or use --${name}=true / --no-${name}.`,
  );
  process.exit(1);
}

export default async function consolidate(args, flags) {
  const [chain, toToken] = args;

  if (!chain || !toToken) {
    printError("missing_args", "Usage: zerion consolidate <chain> <to-token>", {
      example: "zerion consolidate base USDC",
    });
    process.exit(1);
  }

  const execute = coerceBoolFlag(flags.execute, "execute");
  const includeStablesFlag = coerceBoolFlag(flags["include-stables"], "include-stables");
  const excludeStablesFlag = coerceBoolFlag(flags["exclude-stables"], "exclude-stables");
  const includeNative = coerceBoolFlag(flags["include-native"], "include-native");

  if (includeStablesFlag && excludeStablesFlag) {
    printError("conflicting_flags", "Pass either --include-stables or --exclude-stables, not both.");
    process.exit(1);
  }

  let minValueUsd;
  let maxValueUsd;
  let maxLoss;
  let explicitGasReserve;
  let explicitConcurrency;
  try {
    minValueUsd = parseMinValue(flags["min-value"]);
    maxValueUsd = parseMaxValue(flags["max-value"]);
    maxLoss = parseMaxLoss(flags["max-loss"]);
    explicitGasReserve = parseGasReserve(flags["gas-reserve"]);
    explicitConcurrency = parseConcurrency(flags.concurrency);
  } catch (err) {
    printError(err.code || "invalid_flag", err.message);
    process.exit(1);
  }

  // Band sanity: if both bounds are set and the window collapses, every row
  // would be filtered. Surface this as a clear validation error rather than
  // an empty plan.
  if (Number.isFinite(maxValueUsd) && maxValueUsd < minValueUsd) {
    printError(
      "conflicting_flags",
      `--max-value (${maxValueUsd}) must be ≥ --min-value (${minValueUsd}).`,
      {
        suggestion: "Widen the band, drop one of the flags, or swap their values.",
      },
    );
    process.exit(1);
  }

  // Resolve plan-phase quote concurrency. Explicit --concurrency wins; otherwise
  // pick from the active API-key tier. The chosen value + provenance is surfaced
  // in the plan output so callers can verify what actually ran.
  const tier = getApiKeyTier();
  const autoConcurrency = AUTO_CONCURRENCY_BY_TIER[tier] ?? 1;
  const concurrency = explicitConcurrency ?? autoConcurrency;
  const concurrencySource = explicitConcurrency !== undefined ? "flag" : "auto";

  if (explicitGasReserve !== undefined && !includeNative) {
    printError(
      "conflicting_flags",
      "--gas-reserve requires --include-native.",
      {
        suggestion:
          "Pass --include-native to opt in to sweeping the native gas token, then use --gas-reserve to set how much to keep.",
      },
    );
    process.exit(1);
  }

  const slippage = parseSlippage(flags.slippage);
  // High-slippage warning. parseSlippage allows 0–100 (shared across
  // swap/bridge), but consolidate iterates over N positions so an aggressive
  // value compounds. Surface a stderr warning above 5% to nudge operators
  // toward tightening before `--execute`.
  if (slippage != null && slippage > 5) {
    process.stderr.write(
      `Warning: --slippage ${slippage} is high; across an N-position sweep this can ` +
      `realize a large absolute loss. Consider --slippage 2 (default) for liquid targets.\n`,
    );
  }

  const includeSet = parseSymbolList(flags.include);
  const excludeSet = parseSymbolList(flags.exclude);

  const chainCheck = await validateTradingChainAsync(chain, "trade");
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      supportedChains: chainCheck.error.supportedChains,
    });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet({ ...flags, chain });

  // Target token resolution. Symbol matching is unreliable (case, bridged
  // variants, collisions), so resolveTargetToken accepts only curated symbols
  // or raw contract addresses — anything else throws target_token_not_found.
  let target;
  try {
    target = await resolveTargetToken({
      toToken,
      chain,
      api,
      getNativeFungible,
    });
  } catch (err) {
    printError(err.code || "target_token_not_found", err.message, {
      suggestion: err.suggestion,
    });
    process.exit(1);
  }

  const targetUpper = target.symbol;
  const targetAddress = target.address;
  const targetUsdPrice = target.usdPrice;

  // Native gas-token symbol — used by the filter to detect the chain's native
  // currency in positions. Catalog lookup can fail (rate limit / no native
  // fungible); in that case we surface a stderr warning and skip the native
  // exclusion rule (the user can still --exclude it explicitly).
  let nativeSymbol = null;
  try {
    const native = await getNativeFungible(chain);
    nativeSymbol = native?.symbol ? native.symbol.toUpperCase() : null;
  } catch (err) {
    process.stderr.write(
      `Warning: could not resolve native gas token for chain "${chain}" (${err.message}). ` +
      `Skipping native-token exclusion — pass --exclude <symbol> if needed.\n`,
    );
  }

  // Resolve the stables decision. Flag wins; otherwise prompt in a TTY;
  // otherwise default to exclude. The TTY check must happen BEFORE confirm()
  // because confirm() reads non-TTY input via readline and would block on a
  // pipe that never gets a line.
  let includeStables;
  if (includeStablesFlag) {
    includeStables = true;
  } else if (excludeStablesFlag) {
    includeStables = false;
  } else if (process.stdin.isTTY) {
    includeStables = await confirm(
      "Include stables (USDC/USDT/USDS/...) in this sweep? [y/N] ",
      { defaultYes: false },
    );
  } else {
    includeStables = false;
  }

  // Resolve gas reserve — explicit value wins, else per-chain default, else
  // fallback with warning. The reserve only takes effect for the native row;
  // non-native rows ignore it.
  const reserve = resolveGasReserve(chain, explicitGasReserve);
  if (includeNative && reserve.isFallback) {
    process.stderr.write(
      `Warning: no default gas reserve configured for chain "${chain}". ` +
      `Using ${reserve.value} native units — pass --gas-reserve to override.\n`,
    );
  }

  // Positions fetch. Solana rejects `no_filter` on some endpoints — fall back
  // to `only_simple` (which still covers wallet-held tokens, which is what we
  // sweep) when the API returns an unsupported-filter error.
  let positionsResponse;
  try {
    positionsResponse = await api.getPositions(address, {
      chainId: chain,
      positionFilter: "no_filter",
    });
  } catch (err) {
    const msg = err?.message || "";
    if (/position_filter_unsupported|not supported for solana/i.test(msg)) {
      positionsResponse = await api.getPositions(address, {
        chainId: chain,
        positionFilter: "only_simple",
      });
    } else {
      printError(err.code || "positions_error", err.message);
      process.exit(1);
    }
  }

  const ctx = {
    chain,
    targetSymbol: targetUpper,
    targetAddress,
    nativeSymbol,
    includeNative,
    includeStables,
    includeSet,
    excludeSet,
    minValueUsd,
    maxValueUsd,
  };

  const { candidates, skippedDust } = filterCandidates(positionsResponse.data || [], ctx);

  if (candidates.length === 0 && skippedDust.length === 0) {
    print(
      {
        chain,
        toToken,
        walletAddress: address,
        targetUsdPrice,
        rows: [],
        totals: { ready: 0, blocked: 0, skipped: 0, no_route: 0, expected_output: 0, expected_output_usd: null },
        concurrency,
        apiKeyTier: tier,
        concurrencySource,
        executed: false,
      },
      formatConsolidatePlan,
    );
    return;
  }

  let plan;
  try {
    plan = await buildConsolidatePlan({
      candidates,
      skippedDust,
      chain,
      toToken: targetUpper,
      targetUsdPrice,
      walletAddress: address,
      slippage,
      gasReserveValue: reserve.value,
      maxLoss,
      concurrency,
    });
  } catch (err) {
    handleTradingError(err, "consolidate_error");
    return;
  }

  // Annotate the plan with API-key-tier provenance so the pretty formatter
  // can render e.g. "Concurrency: 5 (paid key, auto)" and the JSON consumer
  // sees which mode the planner actually ran in.
  plan.apiKeyTier = tier;
  plan.concurrencySource = concurrencySource;

  if (!execute) {
    // Strip embedded `quote` objects from the dry-run JSON output — they're
    // verbose and not part of the documented row shape. The execute path
    // re-fetches quotes anyway, so persisting them across invocations would
    // be misleading.
    const sanitized = { ...plan, rows: plan.rows.map(stripQuote) };
    print(sanitized, formatConsolidatePlan);
    return;
  }

  // --execute: re-use the freshly-fetched quotes from the plan (within a
  // single invocation we want to broadcast on the same quotes we just showed
  // the user). Cross-invocation staleness is bounded by slippage + on-chain
  // reverts — same approach as bridge's inspect-vs-execute flow.
  const readyRows = plan.rows.filter((r) => r.status === "ready");
  if (readyRows.length === 0) {
    print(
      {
        chain,
        toToken: targetUpper,
        walletAddress: address,
        executed: true,
        results: [],
        summary: { succeeded: 0, failed: 0 },
        note: "No ready rows to execute.",
      },
      formatConsolidateResult,
    );
    return;
  }

  let passphrase;
  try {
    passphrase = await requireAgentToken("for consolidation", walletName);
  } catch (err) {
    handleTradingError(err, "consolidate_error");
    return;
  }
  const timeout = parseTimeout(flags.timeout);

  // Partial-success broadcast — see `executeReadyRows` in
  // cli/utils/trading/consolidate.js for the contract. One failing swap does
  // not gate the rest; failures land in the result with the full error string.
  // `chain` + `walletAddress` are passed in so the helper can manage a local
  // nonce counter across the batch (RPC `latest` lags between successive
  // approvals/swaps, which would otherwise cause `nonce too low` on row K+1).
  const { results, summary } = await executeReadyRows(readyRows, executeSwap, {
    walletName,
    passphrase,
    timeout,
    walletAddress: address,
    chain,
  });

  print(
    {
      chain,
      toToken: targetUpper,
      walletAddress: address,
      executed: true,
      results,
      summary,
    },
    formatConsolidateResult,
  );
}

function stripQuote(row) {
  if (!row || typeof row !== "object" || !("quote" in row)) return row;
  const { quote, ...rest } = row;
  return rest;
}
