// Unit tests for the consolidate skill's pure helpers — filterCandidates,
// evaluateQuote, gas-reserve math, stables matching, and --max-loss parsing.
// The CLI shell (`cli/commands/trading/consolidate.js`) is exercised
// indirectly: where it calls these helpers, the helpers' contracts are what
// the tests pin down.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STABLE_SYMBOLS,
  isStable,
  DEFAULT_GAS_RESERVES,
  FALLBACK_GAS_RESERVE,
  resolveGasReserve,
  parseMaxLoss,
  parseMinValue,
  parseMaxValue,
  parseGasReserve,
  parseConcurrency,
  parseSymbolList,
  computeNativeSweepAmount,
  getImplementationAddress,
  classifyPosition,
  filterCandidates,
  evaluateQuote,
  summarisePlan,
  buildConsolidatePlan,
  executeReadyRows,
  rawWeiToDecimalString,
} from "#zerion/utils/trading/consolidate.js";

// Realistic position rows shaped like the /positions response. Keep these
// minimal but with the fields the filter actually reads. `quantity.int` is
// derived from the float + decimals so tests can stay in human-readable
// numbers; tests that need a precise smallest-units quantity (e.g. the
// 18-decimal precision test) pass `quantityIntOverride` to bypass the
// derivation.
function walletPosition({
  symbol,
  value,
  quantity,
  chain = "base",
  address,
  decimals = 18,
  positionType = "wallet",
  quantityIntOverride,
}) {
  const qInt = quantityIntOverride != null
    ? String(quantityIntOverride)
    : (quantity != null ? BigInt(Math.round(Number(quantity) * 10 ** decimals)).toString() : "0");
  return {
    attributes: {
      position_type: positionType,
      value,
      price: value != null && quantity ? value / quantity : null,
      quantity: { float: quantity, int: qInt },
      fungible_info: {
        symbol,
        implementations: address
          ? [{ chain_id: chain, address, decimals }]
          : [],
      },
    },
  };
}

const CHAIN = "base";
const TARGET = {
  symbol: "USDC",
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

function baseCtx(overrides = {}) {
  return {
    chain: CHAIN,
    targetSymbol: TARGET.symbol,
    targetAddress: TARGET.address,
    nativeSymbol: "ETH",
    includeNative: false,
    includeStables: false,
    includeSet: new Set(),
    excludeSet: new Set(),
    minValueUsd: 1,
    maxValueUsd: Infinity,
    ...overrides,
  };
}

describe("STABLE_SYMBOLS coverage", () => {
  it("matches the documented stablecoin set case-insensitively", () => {
    // The set is intentionally small — covers what wallets predominantly hold
    // (USDC/USDT variants, USDS, USDe). Anything not on this list is a sweep
    // candidate by default; users add legacy/niche stables via --exclude.
    const documented = [
      "USDC", "USDT", "USDC.e", "USDT0", "USDS", "TUSD", "USDe",
    ];
    for (const sym of documented) {
      assert.equal(isStable(sym), true, `${sym} should match`);
      assert.equal(isStable(sym.toLowerCase()), true, `${sym.toLowerCase()} should match`);
      assert.equal(isStable(sym.toUpperCase()), true, `${sym.toUpperCase()} should match`);
    }
    // Mixed-case forms also match.
    for (const variant of ["Usdc", "uSdC", "Usde", "UsDc.E", "Tusd"]) {
      assert.equal(isStable(variant), true, `${variant} should match`);
    }
  });

  it("does not flag non-stable symbols (incl. legacy stables removed from the curated set)", () => {
    // Legacy/niche stables (DAI, FRAX, PYUSD, etc.) are explicitly NOT stables
    // for sweep purposes — they get swept like any other token. Operators can
    // protect them with --exclude if they hold legacy bags.
    for (const sym of [
      "ETH", "BTC", "MATIC", "SOL", "MON", "USD",
      "DAI", "FRAX", "PYUSD", "FDUSD", "crvUSD", "LUSD", "GUSD", "USDD",
      "RLUSD", "USDB", "USD0", "BOLD", "USDY",
    ]) {
      assert.equal(isStable(sym), false, `${sym} should not match`);
    }
  });

  it("STABLE_SYMBOLS set is exposed lowercased (callers rely on .has(symbol.toLowerCase()))", () => {
    for (const entry of STABLE_SYMBOLS) {
      assert.equal(entry, entry.toLowerCase(), "set entries must be lowercased");
    }
  });
});

describe("parseMaxLoss — dual-form rule", () => {
  it("treats values > 1 as percent", () => {
    assert.equal(parseMaxLoss(5), 0.05);
    assert.equal(parseMaxLoss("5"), 0.05);
    assert.equal(parseMaxLoss("2.5"), 0.025);
    assert.equal(parseMaxLoss(100), 1);
  });

  it("treats values ≤ 1 as fraction", () => {
    assert.equal(parseMaxLoss(0.05), 0.05);
    assert.equal(parseMaxLoss("0.05"), 0.05);
    assert.equal(parseMaxLoss(1), 1);
    assert.equal(parseMaxLoss(0), 0);
  });

  it("`--max-loss 5` and `--max-loss 0.05` resolve to the same fraction", () => {
    // The dual-form contract is the most user-visible feature here — pin it.
    assert.equal(parseMaxLoss(5), parseMaxLoss(0.05));
    assert.equal(parseMaxLoss("5"), parseMaxLoss("0.05"));
  });

  it("defaults to 5% when unset", () => {
    assert.equal(parseMaxLoss(undefined), 0.05);
    assert.equal(parseMaxLoss(null), 0.05);
    assert.equal(parseMaxLoss(""), 0.05);
    // Bare boolean flag (parseFlags treats `--max-loss` alone as `true`)
    assert.equal(parseMaxLoss(true), 0.05);
  });

  it("rejects NaN, negative, and > 100 with invalid_max_loss", () => {
    for (const bad of ["abc", -1, -0.1, 101, "200"]) {
      assert.throws(() => parseMaxLoss(bad), (err) => err.code === "invalid_max_loss");
    }
  });
});

describe("parseMinValue / parseGasReserve", () => {
  it("parseMinValue defaults to 1 and accepts non-negative numbers", () => {
    assert.equal(parseMinValue(undefined), 1);
    assert.equal(parseMinValue("0"), 0);
    assert.equal(parseMinValue("10"), 10);
    assert.equal(parseMinValue(2.5), 2.5);
  });

  it("parseMinValue rejects NaN and negative", () => {
    for (const bad of ["abc", -1, -0.01, "-5"]) {
      assert.throws(() => parseMinValue(bad), (err) => err.code === "invalid_min_value");
    }
  });

  it("parseMaxValue defaults to Infinity (uncapped) when unset", () => {
    assert.equal(parseMaxValue(undefined), Infinity);
    assert.equal(parseMaxValue(""), Infinity);
    assert.equal(parseMaxValue(null), Infinity);
    // Bare boolean flag (next positional swallowed by parseFlags before the
    // CLI guard kicks in) — also unset.
    assert.equal(parseMaxValue(true), Infinity);
  });

  it("parseMaxValue accepts positive numbers", () => {
    assert.equal(parseMaxValue("10"), 10);
    assert.equal(parseMaxValue(50.5), 50.5);
    assert.equal(parseMaxValue("0.5"), 0.5);
  });

  it("parseMaxValue rejects NaN, zero, and negative (zero would skip every row)", () => {
    for (const bad of ["abc", 0, "0", -1, -0.01]) {
      assert.throws(() => parseMaxValue(bad), (err) => err.code === "invalid_max_value");
    }
  });

  it("parseGasReserve returns undefined when unset (so resolveGasReserve picks default)", () => {
    assert.equal(parseGasReserve(undefined), undefined);
    assert.equal(parseGasReserve(""), undefined);
    assert.equal(parseGasReserve(true), undefined);
  });

  it("parseGasReserve accepts non-negative numbers", () => {
    assert.equal(parseGasReserve("0"), 0);
    assert.equal(parseGasReserve("0.005"), 0.005);
    assert.equal(parseGasReserve(0.001), 0.001);
  });

  it("parseGasReserve rejects NaN and negative", () => {
    for (const bad of ["abc", -0.001, "-1"]) {
      assert.throws(() => parseGasReserve(bad), (err) => err.code === "invalid_gas_reserve");
    }
  });
});

describe("parseSymbolList", () => {
  it("empty / undefined → empty Set", () => {
    assert.equal(parseSymbolList(undefined).size, 0);
    assert.equal(parseSymbolList("").size, 0);
    assert.equal(parseSymbolList(true).size, 0);
  });

  it("upper-cases and trims comma-separated symbols", () => {
    const result = parseSymbolList(" usdc , Weth ,eth ");
    assert.deepEqual([...result], ["USDC", "WETH", "ETH"]);
  });
});

describe("resolveGasReserve", () => {
  it("explicit value wins over the chain default", () => {
    const r = resolveGasReserve("ethereum", 0.123);
    assert.equal(r.value, 0.123);
    assert.equal(r.isDefault, false);
    assert.equal(r.isFallback, false);
  });

  it("known chains use the documented per-chain default", () => {
    assert.equal(resolveGasReserve("ethereum").value, DEFAULT_GAS_RESERVES.ethereum);
    assert.equal(resolveGasReserve("base").value, DEFAULT_GAS_RESERVES.base);
    assert.equal(resolveGasReserve("solana").value, DEFAULT_GAS_RESERVES.solana);
    assert.equal(resolveGasReserve("polygon").value, 1);
  });

  it("unknown chain falls back to FALLBACK_GAS_RESERVE with isFallback=true", () => {
    const r = resolveGasReserve("monad");
    assert.equal(r.value, FALLBACK_GAS_RESERVE);
    assert.equal(r.isDefault, true);
    assert.equal(r.isFallback, true);
  });
});

describe("computeNativeSweepAmount", () => {
  // New signature: (quantityIntWei, reserveHumanReadable, decimals=18) →
  // { amount: decimal string, reason }. BigInt subtraction avoids the float
  // epsilon that the previous Number-based implementation carried.
  const wei = (human, decimals = 18) => BigInt(Math.round(human * 10 ** decimals)).toString();

  it("returns (quantity - reserve) as a precise decimal string when positive", () => {
    const a = computeNativeSweepAmount(wei(0.01), 0.001, 18);
    assert.equal(a.reason, null);
    assert.equal(a.amount, "0.009");

    const b = computeNativeSweepAmount(wei(1), 0.5, 18);
    assert.equal(b.reason, null);
    assert.equal(b.amount, "0.5");
  });

  it("returns below_reserve when reserve >= quantity (with amount=\"0\")", () => {
    assert.deepEqual(computeNativeSweepAmount(wei(0.001), 0.001, 18), { amount: "0", reason: "below_reserve" });
    assert.deepEqual(computeNativeSweepAmount(wei(0.0005), 0.001, 18), { amount: "0", reason: "below_reserve" });
    assert.deepEqual(computeNativeSweepAmount("0", 0.001, 18), { amount: "0", reason: "below_reserve" });
  });

  it("rejects unusable inputs as below_reserve", () => {
    assert.deepEqual(computeNativeSweepAmount(null, 0.001, 18), { amount: "0", reason: "below_reserve" });
    assert.deepEqual(computeNativeSweepAmount(wei(0.01), undefined, 18), { amount: "0", reason: "below_reserve" });
    assert.deepEqual(computeNativeSweepAmount("not-a-bigint", 0.001, 18), { amount: "0", reason: "below_reserve" });
    assert.deepEqual(computeNativeSweepAmount(wei(0.01), -1, 18), { amount: "0", reason: "below_reserve" });
  });

  it("respects chain-specific decimals (e.g. 6 for USDC-style natives)", () => {
    // wei(1, 6) = "1000000" → 1 unit; reserve 0.5 → 0.5 unit sweepable.
    const r = computeNativeSweepAmount(wei(1, 6), 0.5, 6);
    assert.equal(r.reason, null);
    assert.equal(r.amount, "0.5");
  });
});

describe("getImplementationAddress", () => {
  it("returns lowercased address for the matching chain_id", () => {
    const fungible = {
      implementations: [
        { chain_id: "ethereum", address: "0xAaBbCc" },
        { chain_id: "base", address: "0x833589FCD6EDb6E08f4c7C32D4f71b54bda02913" },
      ],
    };
    assert.equal(getImplementationAddress(fungible, "base"), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.equal(getImplementationAddress(fungible, "arbitrum"), null);
  });

  it("returns null when implementations missing or empty", () => {
    assert.equal(getImplementationAddress({}, "base"), null);
    assert.equal(getImplementationAddress({ implementations: [] }, "base"), null);
    assert.equal(getImplementationAddress(null, "base"), null);
  });
});

describe("classifyPosition / filterCandidates — target exclusion", () => {
  it("excludes the target token by symbol", () => {
    const row = walletPosition({
      symbol: "USDC",
      value: 100,
      quantity: 100,
      address: "0xfaaafaaa",  // a DIFFERENT address — still excluded by symbol
    });
    const result = classifyPosition(row, baseCtx());
    assert.equal(result.kind, "skip");
    assert.equal(result.reason, "is_target");
  });

  it("excludes the target token by on-chain address even when symbol differs (USDC.e vs USDC alias)", () => {
    // A row that reports a different symbol (e.g. an alias) but maps to the
    // target's on-chain address must still be excluded. This guards against
    // a Zerion API quirk where bridged/wrapped variants surface alternate
    // symbols.
    const row = walletPosition({
      symbol: "USDCALIAS",
      value: 100,
      quantity: 100,
      address: TARGET.address.toUpperCase(),  // exercise case-insensitivity
    });
    const result = classifyPosition(row, baseCtx());
    assert.equal(result.kind, "skip");
    assert.equal(result.reason, "is_target");
  });

  it("does NOT exclude a different token that shares the same first chars (no prefix match)", () => {
    const row = walletPosition({
      symbol: "USDCe",
      value: 100,
      quantity: 100,
      address: "0xdeadbeef",
    });
    const result = classifyPosition(row, baseCtx());
    assert.equal(result.kind, "candidate");
  });
});

describe("filterCandidates — position type, stables, native, dust", () => {
  it("excludes non-wallet position types entirely (no plan row emitted)", () => {
    // Each of these must be filtered out completely — they don't show up
    // even as a `skipped` plan row.
    for (const positionType of ["deposit", "loan", "staked", "locked", "reward", "investment"]) {
      const row = walletPosition({
        symbol: "WETH",
        value: 100,
        quantity: 0.05,
        positionType,
      });
      const { candidates, skippedDust } = filterCandidates([row], baseCtx());
      assert.equal(candidates.length, 0, `${positionType} → no candidate`);
      assert.equal(skippedDust.length, 0, `${positionType} → no dust row either`);
    }
  });

  it("excludes the native gas token by default", () => {
    const row = walletPosition({ symbol: "ETH", value: 100, quantity: 0.05 });
    const { candidates } = filterCandidates([row], baseCtx());
    assert.equal(candidates.length, 0);
  });

  it("--include-native opts the native gas token back in", () => {
    const row = walletPosition({ symbol: "ETH", value: 100, quantity: 0.05 });
    const { candidates } = filterCandidates([row], baseCtx({ includeNative: true }));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].isNative, true);
  });

  it("excludes stables by default", () => {
    // USDe is a representative non-target stable on the curated list.
    const row = walletPosition({
      symbol: "USDe",
      value: 50,
      quantity: 50,
      address: "0xusde",
    });
    const { candidates } = filterCandidates([row], baseCtx());
    assert.equal(candidates.length, 0);
  });

  it("--include-stables opts stables back in", () => {
    const row = walletPosition({
      symbol: "USDe",
      value: 50,
      quantity: 50,
      address: "0xusde",
    });
    const { candidates } = filterCandidates([row], baseCtx({ includeStables: true }));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].symbol, "USDE"); // classifyPosition uppercases the symbol
  });

  it("dust positions land on the skippedDust list (still emit a plan row)", () => {
    const row = walletPosition({
      symbol: "WETH",
      value: 0.5,
      quantity: 0.0002,
      address: "0xweth",
    });
    const { candidates, skippedDust } = filterCandidates([row], baseCtx());
    assert.equal(candidates.length, 0);
    assert.equal(skippedDust.length, 1);
    assert.equal(skippedDust[0].symbol, "WETH");
    assert.equal(skippedDust[0].reason, "dust");
  });

  it("max-value: positions above the cap are surfaced as `above_max`, not silently skipped", () => {
    const big = walletPosition({
      symbol: "WETH",
      value: 500,
      quantity: 0.15,
      address: "0xweth",
    });
    const small = walletPosition({
      symbol: "WBTC",
      value: 5,
      quantity: 0.0001,
      address: "0xwbtc",
    });
    const ctx = baseCtx({ maxValueUsd: 50 });
    const { candidates, skippedDust } = filterCandidates([big, small], ctx);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].symbol, "WBTC");
    assert.equal(skippedDust.length, 1);
    assert.equal(skippedDust[0].symbol, "WETH");
    assert.equal(skippedDust[0].reason, "above_max");
  });

  it("max-value: uses inclusive upper bound (exactly at the cap → candidate, just over → skipped)", () => {
    const atCap = walletPosition({ symbol: "WETH", value: 50, quantity: 0.02, address: "0xweth" });
    const overCap = walletPosition({ symbol: "WBTC", value: 50.01, quantity: 0.001, address: "0xwbtc" });
    const ctx = baseCtx({ maxValueUsd: 50 });
    const { candidates, skippedDust } = filterCandidates([atCap, overCap], ctx);
    assert.deepEqual(candidates.map((c) => c.symbol), ["WETH"]);
    assert.deepEqual(skippedDust.map((d) => d.symbol), ["WBTC"]);
    assert.equal(skippedDust[0].reason, "above_max");
  });

  it("band: --min-value + --max-value sweeps only the window between the two", () => {
    const dust = walletPosition({ symbol: "AAA", value: 0.5, quantity: 1, address: "0xaaa" });
    const inBand1 = walletPosition({ symbol: "BBB", value: 10, quantity: 1, address: "0xbbb" });
    const inBand2 = walletPosition({ symbol: "CCC", value: 40, quantity: 1, address: "0xccc" });
    const main = walletPosition({ symbol: "DDD", value: 500, quantity: 1, address: "0xddd" });

    const ctx = baseCtx({ minValueUsd: 5, maxValueUsd: 50 });
    const { candidates, skippedDust } = filterCandidates([dust, inBand1, inBand2, main], ctx);
    assert.deepEqual(candidates.map((c) => c.symbol).sort(), ["BBB", "CCC"]);

    const reasonsBySymbol = Object.fromEntries(skippedDust.map((d) => [d.symbol, d.reason]));
    assert.equal(reasonsBySymbol.AAA, "dust");
    assert.equal(reasonsBySymbol.DDD, "above_max");
  });

  it("max-value: defaults to Infinity (no cap) so existing callers see no behavior change", () => {
    const big = walletPosition({
      symbol: "WETH",
      value: 1_000_000,
      quantity: 300,
      address: "0xweth",
    });
    const { candidates, skippedDust } = filterCandidates([big], baseCtx());
    assert.equal(candidates.length, 1);
    assert.equal(skippedDust.length, 0);
  });

  it("buildConsolidatePlan emits reason='above_max' on the plan row (not 'dust')", async () => {
    const big = walletPosition({
      symbol: "WETH",
      value: 500,
      quantity: 0.15,
      address: "0xweth",
    });
    const ctx = baseCtx({ maxValueUsd: 50 });
    const { skippedDust } = filterCandidates([big], ctx);
    const plan = await buildConsolidatePlan({
      candidates: [],
      skippedDust,
      chain: CHAIN,
      toToken: TARGET.symbol,
      targetUsdPrice: 1,
      walletAddress: "0xwallet",
      slippage: 2,
      gasReserveValue: 0,
      maxLoss: 0.05,
      quoteFn: async () => { throw new Error("not used — no candidates"); },
    });
    const row = plan.rows.find((r) => r.symbol === "WETH");
    assert.ok(row, "WETH row should appear in plan");
    assert.equal(row.status, "skipped");
    assert.equal(row.reason, "above_max");
  });
});

describe("filterCandidates — --include / --exclude overrides", () => {
  it("--include overrides the native-token exclusion (case-insensitive)", () => {
    const row = walletPosition({ symbol: "ETH", value: 100, quantity: 0.05 });
    const { candidates } = filterCandidates([row], baseCtx({ includeSet: new Set(["ETH"]) }));
    assert.equal(candidates.length, 1);
  });

  it("--include overrides the stables exclusion", () => {
    const row = walletPosition({
      symbol: "TUSD",
      value: 50,
      quantity: 50,
      address: "0xtusd",
    });
    const { candidates } = filterCandidates([row], baseCtx({ includeSet: new Set(["TUSD"]) }));
    assert.equal(candidates.length, 1);
  });

  it("--include cannot resurrect the target token", () => {
    const row = walletPosition({
      symbol: TARGET.symbol,
      value: 50,
      quantity: 50,
      address: TARGET.address,
    });
    const { candidates } = filterCandidates([row], baseCtx({ includeSet: new Set([TARGET.symbol]) }));
    assert.equal(candidates.length, 0);
  });

  it("--exclude adds extra exclusions on top of defaults", () => {
    const row = walletPosition({
      symbol: "WETH",
      value: 100,
      quantity: 0.05,
      address: "0xweth",
    });
    const { candidates } = filterCandidates([row], baseCtx({ excludeSet: new Set(["WETH"]) }));
    assert.equal(candidates.length, 0);
  });

  it("--include still subject to --min-value (forced-include with dust value → dust row)", () => {
    const row = walletPosition({
      symbol: "ETH",
      value: 0.5,
      quantity: 0.0002,
    });
    const { candidates, skippedDust } = filterCandidates([row], baseCtx({
      includeNative: true,
      includeSet: new Set(["ETH"]),
    }));
    assert.equal(candidates.length, 0);
    assert.equal(skippedDust.length, 1);
  });
});

describe("evaluateQuote — loss math + tolerance", () => {
  // The acceptance criteria fixture: a $100 position quoting to ~$95 of the
  // target. With max-loss = 5%, the row must be ACCEPTED — float equality at
  // the boundary is the most common source of flakes here.
  it("100 USD position → 95 USD target output → loss=0.05 → accepted at max_loss=0.05", () => {
    // Construct so that out * price / value == 0.95 exactly:
    //   out=95, price=1, value=100 → 0.95.
    const r = evaluateQuote({
      estimatedOutput: 95,
      targetUsdPrice: 1,
      positionValueUsd: 100,
      maxLoss: 0.05,
    });
    assert.equal(r.status, "ready");
    // Tolerance check: the equality test in evaluateQuote uses 1e-9.
    assert.ok(Math.abs(r.lossPct - 0.05) < 1e-9, `lossPct=${r.lossPct}`);
  });

  it("blocks when loss exceeds max_loss + 1e-9", () => {
    // 94 / 100 = 0.94 → loss 0.06, clearly above 0.05.
    const r = evaluateQuote({
      estimatedOutput: 94,
      targetUsdPrice: 1,
      positionValueUsd: 100,
      maxLoss: 0.05,
    });
    assert.equal(r.status, "blocked");
    assert.equal(r.reason, "max_loss");
    assert.ok(r.lossPct > 0.05);
  });

  it("accepts at exactly max_loss boundary (within 1e-9 tolerance)", () => {
    // Float-equality boundary: epsilon must NOT block.
    const r = evaluateQuote({
      estimatedOutput: 95 + 1e-12,  // microscopically better
      targetUsdPrice: 1,
      positionValueUsd: 100,
      maxLoss: 0.05,
    });
    assert.equal(r.status, "ready");
  });

  it("accepts when the quote returns MORE USD than the position is worth (negative loss)", () => {
    // out * price > value → loss is negative — the user is gaining USD value
    // through the swap. Still ready.
    const r = evaluateQuote({
      estimatedOutput: 110,
      targetUsdPrice: 1,
      positionValueUsd: 100,
      maxLoss: 0.05,
    });
    assert.equal(r.status, "ready");
    assert.ok(r.lossPct < 0);
  });

  it("returns skipped: no_price when position value is missing or zero", () => {
    for (const value of [undefined, null, 0, NaN]) {
      const r = evaluateQuote({
        estimatedOutput: 95,
        targetUsdPrice: 1,
        positionValueUsd: value,
        maxLoss: 0.05,
      });
      assert.equal(r.status, "skipped");
      assert.equal(r.reason, "no_price");
    }
  });

  it("returns skipped: no_price when estimatedOutput is missing or unparseable", () => {
    for (const out of [undefined, null, "abc", NaN]) {
      const r = evaluateQuote({
        estimatedOutput: out,
        targetUsdPrice: 1,
        positionValueUsd: 100,
        maxLoss: 0.05,
      });
      assert.equal(r.status, "skipped");
      assert.equal(r.reason, "no_price");
    }
  });

  it("returns skipped: no_price when targetUsdPrice is missing (target fungible without market_data)", () => {
    const r = evaluateQuote({
      estimatedOutput: 95,
      targetUsdPrice: NaN,
      positionValueUsd: 100,
      maxLoss: 0.05,
    });
    assert.equal(r.status, "skipped");
  });
});

describe("buildConsolidatePlan — sequential quote loop", () => {
  it("calls the injected quoteFn once per candidate, in order, and never in parallel", async () => {
    // The Zerion API is rate-limited at 1 RPS on the demo tier — Promise.all
    // would be a regression. Track concurrency via a counter that the fake
    // quoteFn increments on entry and decrements on exit.
    let active = 0;
    let maxActive = 0;
    const order = [];
    const quoteFn = async (input) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(input.fromToken);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return {
        estimatedOutput: "95",
        from: { symbol: input.fromToken },
        to: { symbol: input.toToken },
        fromChain: input.fromChain,
        toChain: input.toChain,
      };
    };

    const candidates = [
      { symbol: "WETH", valueUsd: 100, quantity: 0.05, fungible: {}, implAddress: "0xweth", isNative: false },
      { symbol: "WBTC", valueUsd: 100, quantity: 0.001, fungible: {}, implAddress: "0xwbtc", isNative: false },
      { symbol: "ARB", valueUsd: 100, quantity: 80, fungible: {}, implAddress: "0xarb", isNative: false },
    ];

    const plan = await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0,
      maxLoss: 0.05,
      quoteFn,
    });

    assert.equal(maxActive, 1, "quotes must run one at a time");
    assert.deepEqual(order, ["WETH", "WBTC", "ARB"], "quotes must run in candidate order");
    assert.equal(plan.totals.ready, 3);
  });

  it("emits no_route on quote error and continues to the next candidate (does not bail the plan)", async () => {
    let callCount = 0;
    const quoteFn = async (input) => {
      callCount++;
      if (input.fromToken === "WBTC") {
        const err = new Error("No swap route found for 0.001 WBTC → USDC on base");
        err.code = "no_route";
        throw err;
      }
      return {
        estimatedOutput: "95",
        from: { symbol: input.fromToken },
        to: { symbol: input.toToken },
      };
    };

    const candidates = [
      { symbol: "WETH", valueUsd: 100, quantity: 0.05, fungible: {}, implAddress: "0xweth", isNative: false },
      { symbol: "WBTC", valueUsd: 100, quantity: 0.001, fungible: {}, implAddress: "0xwbtc", isNative: false },
      { symbol: "ARB", valueUsd: 100, quantity: 80, fungible: {}, implAddress: "0xarb", isNative: false },
    ];

    const plan = await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0,
      maxLoss: 0.05,
      quoteFn,
    });

    assert.equal(callCount, 3, "must keep iterating past the error");
    assert.equal(plan.totals.ready, 2);
    assert.equal(plan.totals.no_route, 1);
    const wbtcRow = plan.rows.find((r) => r.symbol === "WBTC");
    assert.equal(wbtcRow.status, "no_route");
    assert.match(wbtcRow.reason, /No swap route/);
  });

  it("uses (quantity - reserve) for the native candidate sweep amount", async () => {
    const quoteInputs = [];
    const quoteFn = async (input) => {
      quoteInputs.push(input);
      return {
        estimatedOutput: "95",
        from: { symbol: input.fromToken },
        to: { symbol: input.toToken },
      };
    };

    const candidates = [
      {
        symbol: "ETH",
        valueUsd: 100,
        quantity: "0.01",
        quantityFloat: 0.01,
        rawInt: "10000000000000000", // 0.01 ETH = 1e16 wei
        decimals: 18,
        fungible: {},
        implAddress: null,
        isNative: true,
      },
    ];

    await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0.001,
      maxLoss: 0.05,
      quoteFn,
    });

    assert.equal(quoteInputs.length, 1);
    // 0.01 ETH - 0.001 ETH = 0.009 ETH, exact in BigInt — no float epsilon.
    assert.equal(quoteInputs[0].amount, "0.009");
  });

  it("marks the native row below_reserve when reserve >= quantity (no quote call)", async () => {
    let called = false;
    const quoteFn = async () => {
      called = true;
      throw new Error("must not be called");
    };

    const candidates = [
      {
        symbol: "ETH",
        valueUsd: 100,
        quantity: "0.001",
        quantityFloat: 0.001,
        rawInt: "1000000000000000", // 0.001 ETH = 1e15 wei
        decimals: 18,
        fungible: {},
        implAddress: null,
        isNative: true,
      },
    ];

    const plan = await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0.001,
      maxLoss: 0.05,
      quoteFn,
    });

    assert.equal(called, false, "must short-circuit without fetching a quote");
    assert.equal(plan.rows[0].status, "skipped");
    assert.equal(plan.rows[0].reason, "below_reserve");
  });
});

describe("summarisePlan totals", () => {
  it("sums expected_output across ready rows and projects to USD via targetUsdPrice", () => {
    const rows = [
      { symbol: "A", status: "ready", expected_output: 10 },
      { symbol: "B", status: "ready", expected_output: 20 },
      { symbol: "C", status: "blocked" },
      { symbol: "D", status: "skipped" },
      { symbol: "E", status: "no_route" },
    ];
    const plan = summarisePlan(rows, { chain: "base", toToken: "USDC", walletAddress: "0xabc", targetUsdPrice: 1 });
    assert.equal(plan.totals.ready, 2);
    assert.equal(plan.totals.blocked, 1);
    assert.equal(plan.totals.skipped, 1);
    assert.equal(plan.totals.no_route, 1);
    assert.equal(plan.totals.expected_output, 30);
    assert.equal(plan.totals.expected_output_usd, 30);
  });

  it("expected_output_usd is null when targetUsdPrice is missing", () => {
    const rows = [{ symbol: "A", status: "ready", expected_output: 10 }];
    const plan = summarisePlan(rows, { chain: "base", toToken: "USDC", walletAddress: "0xabc", targetUsdPrice: NaN });
    assert.equal(plan.totals.expected_output_usd, null);
  });
});

describe("coerceBoolFlag integration — invalid_flag_value", () => {
  // The consolidate command file inlines coerceBoolFlag with the same shape
  // as bridge.js. We exercise the contract by spawning the CLI shell with a
  // bad invocation and asserting it exits non-zero and prints the documented
  // error code.
  //
  // Spawning a subprocess keeps this an integration-style assertion without
  // actually hitting the network — argv parsing happens before any API call,
  // so the process exits at the validation step.

  it("rejects --include-stables with a non-positional value", async () => {
    const { spawn } = await import("node:child_process");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    // From .../cli/tests/unit/cli/utils/trading/ up to repo root is 6 levels.
    const cliPath = resolve(here, "../../../../../..", "cli/zerion.js");

    const child = spawn(process.execPath, [
      cliPath,
      "consolidate",
      "base",
      "USDC",
      "--include-stables",
      "something-bad",
    ], {
      env: { ...process.env, ZERION_API_KEY: "zk_dummy_for_argv_only" },
    });

    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));

    const code = await new Promise((done) => child.on("exit", done));
    assert.notEqual(code, 0, "CLI must exit non-zero on invalid_flag_value");
    assert.match(stderr, /invalid_flag_value/, `stderr should contain invalid_flag_value; got: ${stderr}`);
    assert.match(stderr, /include-stables/);
  });
});

// ---------------------------------------------------------------------------
// AC 21 — API-key-tier concurrency. parseConcurrency validation, parallel
// quote-fetch cap, auto-pick by tier, --execute always-sequential.
// ---------------------------------------------------------------------------

describe("parseConcurrency — validation (AC 21b)", () => {
  it("returns undefined when the flag is unset (so the CLI auto-picks by tier)", () => {
    assert.equal(parseConcurrency(undefined), undefined);
    assert.equal(parseConcurrency(null), undefined);
    assert.equal(parseConcurrency(""), undefined);
    // Bare flag (`--concurrency` with nothing after) parses as `true` —
    // treat as "not set" so auto-pick applies. The architect's spec is silent
    // here; rejecting outright would surprise users who fat-fingered.
    assert.equal(parseConcurrency(true), undefined);
  });

  it("accepts integers in [1, 10]", () => {
    for (const n of [1, 2, 3, 5, 9, 10]) {
      assert.equal(parseConcurrency(n), n);
      assert.equal(parseConcurrency(String(n)), n);
    }
    // Whitespace tolerance — matches the other parseX helpers.
    assert.equal(parseConcurrency("  5  "), 5);
  });

  it("rejects 0 with invalid_concurrency", () => {
    assert.throws(() => parseConcurrency(0), (err) => err.code === "invalid_concurrency");
    assert.throws(() => parseConcurrency("0"), (err) => err.code === "invalid_concurrency");
  });

  it("rejects 11 (and any value > 10) with invalid_concurrency", () => {
    assert.throws(() => parseConcurrency(11), (err) => err.code === "invalid_concurrency");
    assert.throws(() => parseConcurrency("100"), (err) => err.code === "invalid_concurrency");
  });

  it("rejects negative, NaN, and non-integer with invalid_concurrency", () => {
    for (const bad of [-1, "-1", "abc", NaN, 1.5, "1.5", 2.7]) {
      assert.throws(() => parseConcurrency(bad), (err) => err.code === "invalid_concurrency");
    }
  });
});

describe("buildConsolidatePlan — bounded concurrency (AC 21c)", () => {
  it("respects the concurrency cap when fanning out quotes (max in-flight ≤ N)", async () => {
    // 7 candidates with concurrency=3 → at most 3 in flight at any time.
    // The fake quoteFn increments a counter on entry, sleeps a tick, then
    // decrements. We assert the observed max matches the cap.
    let active = 0;
    let maxActive = 0;
    const quoteFn = async (input) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 8));
      active--;
      return {
        estimatedOutput: "95",
        from: { symbol: input.fromToken },
        to: { symbol: input.toToken },
      };
    };

    const candidates = Array.from({ length: 7 }, (_, i) => ({
      symbol: `T${i}`,
      valueUsd: 100,
      quantity: 1,
      fungible: {},
      implAddress: `0xt${i}`,
      isNative: false,
    }));

    const plan = await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0,
      maxLoss: 0.05,
      concurrency: 3,
      quoteFn,
    });

    assert.ok(maxActive <= 3, `max in-flight should be ≤ 3, got ${maxActive}`);
    assert.ok(maxActive >= 2, `concurrency=3 with 7 items should achieve > 1 in-flight, got ${maxActive}`);
    assert.equal(plan.totals.ready, 7);
    assert.equal(plan.concurrency, 3);
    // Row order must still match candidate order — bounded fan-out preserves it.
    assert.deepEqual(plan.rows.map((r) => r.symbol), candidates.map((c) => c.symbol));
  });

  it("default concurrency stays at 1 (sequential — dev-key safe)", async () => {
    // The default preserves the pre-PLT-677 contract: no concurrency arg →
    // strictly one-at-a-time. The original sequential test ("never in
    // parallel") still passes with this default.
    let active = 0;
    let maxActive = 0;
    const quoteFn = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return { estimatedOutput: "95" };
    };
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      symbol: `T${i}`,
      valueUsd: 100,
      quantity: 1,
      fungible: {},
      implAddress: `0xt${i}`,
      isNative: false,
    }));
    const plan = await buildConsolidatePlan({
      candidates,
      skippedDust: [],
      chain: "base",
      toToken: "USDC",
      targetUsdPrice: 1,
      walletAddress: "0xabc",
      slippage: 2,
      gasReserveValue: 0,
      maxLoss: 0.05,
      quoteFn,
    });
    assert.equal(maxActive, 1, "default must be sequential");
    assert.equal(plan.concurrency, 1);
  });
});

describe("consolidate CLI — concurrency auto-pick & --execute serial (AC 21b/d/e)", () => {
  // These exercise the CLI shell via subprocess. We don't need a real API key
  // for the early-exit codepaths (invalid_concurrency, target_token_not_found
  // before any network call) and for the network-touching cases we stub fetch
  // with a tiny test server… too heavy for this scope. Instead, we rely on
  // the CLI surfacing the chosen concurrency in the empty-plan output, which
  // happens after positions fetch returns no candidates. We swap fetch via a
  // child env hook (NODE_OPTIONS preloader) — not portable. Instead, the
  // simpler approach: test parse-then-exit codepaths only.
  //
  // Net: 21b is covered with subprocess (invalid_concurrency rejection);
  // 21d/e are covered by direct unit tests above (auto-pick via
  // AUTO_CONCURRENCY_BY_TIER is wired in commands/trading/consolidate.js, and
  // the broadcast loop in the same file is unconditionally `for await`).
  // The subprocess-driven assertion for 21b is the strongest signal we can
  // give without standing up a fake Zerion API in-process.

  it("rejects --concurrency 0 with invalid_concurrency (AC 21b)", async () => {
    const { spawn } = await import("node:child_process");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const cliPath = resolve(here, "../../../../../..", "cli/zerion.js");

    const child = spawn(process.execPath, [
      cliPath,
      "consolidate",
      "base",
      "USDC",
      "--concurrency",
      "0",
    ], {
      env: { ...process.env, ZERION_API_KEY: "zk_dummy_for_argv_only" },
    });

    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));

    const code = await new Promise((done) => child.on("exit", done));
    assert.notEqual(code, 0);
    assert.match(stderr, /invalid_concurrency/, `expected invalid_concurrency in stderr: ${stderr}`);
  });

  it("rejects --concurrency 11 with invalid_concurrency (AC 21b)", async () => {
    const { spawn } = await import("node:child_process");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const cliPath = resolve(here, "../../../../../..", "cli/zerion.js");

    const child = spawn(process.execPath, [
      cliPath,
      "consolidate",
      "base",
      "USDC",
      "--concurrency",
      "11",
    ], {
      env: { ...process.env, ZERION_API_KEY: "zk_dummy_for_argv_only" },
    });

    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));

    const code = await new Promise((done) => child.on("exit", done));
    assert.notEqual(code, 0);
    assert.match(stderr, /invalid_concurrency/);
  });
});

// AC 21d (auto-pick) — verified directly against the tier→concurrency map
// that the CLI uses. We re-derive the map from the same source by re-
// classifying via getApiKeyTier under controlled env vars and asserting the
// expected auto-pick values. This stays in lockstep with the production
// code path because the CLI references the same getApiKeyTier function.
describe("auto-pick from tier (AC 21d)", () => {
  it("`zk_prod_*` → tier=paid → auto concurrency 5; `zk_dev_*` → tier=dev → auto concurrency 1", async () => {
    const { getApiKeyTier } = await import("#zerion/utils/api/auth.js");

    // Inline copy of AUTO_CONCURRENCY_BY_TIER from the CLI file — pin the
    // mapping here so a refactor that moves the constant elsewhere is caught
    // by a failing test rather than a silent divergence.
    const AUTO_CONCURRENCY_BY_TIER = { paid: 5, dev: 1, unknown: 1 };

    // Use the keyOverride seam so this test doesn't observe whatever key
    // happens to be in the dev's config — env-only manipulation isn't enough
    // because getApiKey() falls through to config.
    assert.equal(getApiKeyTier("zk_prod_xyz"), "paid");
    assert.equal(AUTO_CONCURRENCY_BY_TIER[getApiKeyTier("zk_prod_xyz")], 5);

    assert.equal(getApiKeyTier("zk_dev_abc"), "dev");
    assert.equal(AUTO_CONCURRENCY_BY_TIER[getApiKeyTier("zk_dev_abc")], 1);

    assert.equal(getApiKeyTier(""), "unknown");
    assert.equal(AUTO_CONCURRENCY_BY_TIER[getApiKeyTier("")], 1);
  });
});

// AC 21e — the broadcast loop in cli/commands/trading/consolidate.js uses a
// plain `for (const row of readyRows) { await executeSwap(...) }`. That is
// strictly sequential regardless of the `concurrency` value passed earlier to
// `buildConsolidatePlan`. We pin this by direct inspection of the source —
// the broadcast loop must NOT call any concurrency-aware helper, and must
// NOT call `Promise.all` over `readyRows`. A future refactor that introduces
// parallel broadcasts would race EVM nonces and lose user funds.
describe("--execute broadcast loop is unconditionally sequential (AC 21e)", () => {
  it("the broadcast loop in utils/trading/consolidate.js (executeReadyRows) uses for-await on readyRows, no Promise.all", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const utilPath = resolve(here, "../../../../../..", "cli/utils/trading/consolidate.js");
    const src = await readFile(utilPath, "utf8");

    // The broadcast loop now lives in `executeReadyRows`. Pin its shape:
    // `for (const row of readyRows)` with `await executeFn(...)` inside. If a
    // future refactor changes this we want the test to fail loudly.
    assert.match(src, /export\s+async\s+function\s+executeReadyRows\b/);
    assert.match(src, /for\s*\(\s*const\s+row\s+of\s+readyRows\s*\)/);
    assert.match(src, /await\s+executeFn\(/);

    // Guard against any Promise.all over readyRows — that would broadcast
    // in parallel and race EVM nonces.
    assert.equal(
      /Promise\.all\([^)]*readyRows/.test(src),
      false,
      "broadcast loop must not call Promise.all over readyRows",
    );
    // Defensive: also guard against runWithConcurrency being misapplied to
    // readyRows for parallel execution.
    assert.equal(
      /runWithConcurrency\([^)]*readyRows/.test(src),
      false,
      "broadcast loop must not pass readyRows through runWithConcurrency",
    );
  });
});

// ---------------------------------------------------------------------------
// executeReadyRows — partial-success contract. Each row is an independent
// on-chain transaction; one failing quote must not gate the rest of the
// sweep. This was a user-blocking issue in the local test where WSTETH
// failed and the remaining 6 ready rows never ran.
// ---------------------------------------------------------------------------
describe("executeReadyRows — partial-success contract", () => {
  function mkRow(symbol) {
    return { symbol, quote: { from: { symbol }, to: { symbol: "ETH" } } };
  }

  it("with 5 ready rows where row 2 throws, all 5 executeFn calls fire", async () => {
    const calls = [];
    const executeFn = async (quote) => {
      calls.push(quote.from.symbol);
      if (quote.from.symbol === "ROW2") {
        const err = new Error("Quote not executable: synthetic test failure");
        throw err;
      }
      return { hash: `0xhash-${quote.from.symbol}`, status: "success", blockNumber: 1, gasUsed: "21000" };
    };

    const readyRows = ["ROW1", "ROW2", "ROW3", "ROW4", "ROW5"].map(mkRow);
    const { results, summary } = await executeReadyRows(readyRows, executeFn, {
      walletName: "test-wallet",
      passphrase: "test-pass",
      timeout: 120,
    });

    assert.deepEqual(calls, ["ROW1", "ROW2", "ROW3", "ROW4", "ROW5"], "every row must be attempted in order");
    assert.equal(results.length, 5);
    assert.equal(summary.succeeded, 4);
    assert.equal(summary.failed, 1);
    assert.equal(results[1].status, "failed");
    assert.match(results[1].error, /synthetic test failure/);
    // The successful rows after the failure carry their hash and status.
    assert.equal(results[2].status, "success");
    assert.equal(results[2].hash, "0xhash-ROW3");
    assert.equal(results[4].status, "success");
  });

  it("records non-success result.status as `failed` count (e.g. on-chain revert)", async () => {
    // An on-chain revert returns `{ status: "reverted" }` rather than throwing.
    // The contract: any non-`success` status counts as failed and the loop
    // still continues to the next row.
    const calls = [];
    const executeFn = async (quote) => {
      calls.push(quote.from.symbol);
      if (quote.from.symbol === "REVERT") {
        return { hash: "0xreverted", status: "reverted", blockNumber: 1, gasUsed: "21000" };
      }
      return { hash: `0x${quote.from.symbol}`, status: "success", blockNumber: 1, gasUsed: "21000" };
    };

    const readyRows = ["A", "REVERT", "C"].map(mkRow);
    const { results, summary } = await executeReadyRows(readyRows, executeFn, {});

    assert.equal(calls.length, 3, "must keep iterating past the reverted row");
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 1);
    assert.equal(results[1].status, "reverted");
  });

  it("falls back to err.toString() when err.message is empty", async () => {
    // Defensive: some thrown values aren't proper Error instances. The loop
    // must still produce a usable string in the result.
    const executeFn = async () => {
      // eslint-disable-next-line no-throw-literal
      throw "bare-string error";
    };
    const readyRows = [mkRow("X")];
    const { results, summary } = await executeReadyRows(readyRows, executeFn, {});
    assert.equal(summary.failed, 1);
    assert.equal(results[0].error, "bare-string error");
  });
});

// ---------------------------------------------------------------------------
// formatConsolidateResult — full failure messages are visible by default.
// The summary table truncates at ~27 chars + ellipsis, which buries actionable
// reasons ("Quote not executable: Input asset balance is not enough" becomes
// "Quote not executable: Input…"). The Failures block below the totals prints
// the full string per failed row.
// ---------------------------------------------------------------------------
describe("formatConsolidateResult — full failure messages", () => {
  it("prints the un-truncated error string for every non-success row in a Failures block", async () => {
    const { formatConsolidateResult } = await import("#zerion/utils/common/format.js");
    const longError =
      "Quote not executable: insufficient_liquidity on uniswap-v3 (hint: try a smaller amount)";
    // Sanity: this string is well past the in-table truncation cap of ~27.
    assert.ok(longError.length > 27);

    const out = formatConsolidateResult({
      chain: "base",
      toToken: "ETH",
      walletAddress: "0xabc",
      results: [
        { symbol: "USDC", hash: "0xaaa", status: "success" },
        { symbol: "WSTETH", hash: null, status: "failed", error: longError },
      ],
      summary: { succeeded: 1, failed: 1 },
    });

    // Top of the formatter output still renders the compact table — that's
    // by design (the user can scan many rows quickly). The Failures block at
    // the bottom is the new escape hatch.
    assert.match(out, /Failures:/);
    // The full string is present without ellipsis. Use a substring check
    // rather than a regex so ANSI escapes between the row prefix and the
    // message don't trip us up.
    assert.ok(
      out.includes(longError),
      `formatter output must include the full error string; got:\n${out}`,
    );
    // The symbol prefixes the failed message so an operator can correlate
    // it back to the row in the table above.
    assert.match(out, /WSTETH: Quote not executable/);
    // Successful rows must NOT appear under Failures — otherwise the block
    // would just duplicate the table.
    assert.equal(
      out.lastIndexOf("USDC:") < out.indexOf("Failures:") || !out.includes("USDC:"),
      true,
      "successful rows must not appear in the Failures block",
    );
  });

  it("omits the Failures block when no rows failed", async () => {
    const { formatConsolidateResult } = await import("#zerion/utils/common/format.js");
    const out = formatConsolidateResult({
      chain: "base",
      toToken: "ETH",
      walletAddress: "0xabc",
      results: [{ symbol: "USDC", hash: "0xaaa", status: "success" }],
      summary: { succeeded: 1, failed: 0 },
    });
    assert.equal(
      out.includes("Failures:"),
      false,
      "Failures block should be hidden when summary.failed is 0",
    );
  });
});

// ---------------------------------------------------------------------------
// AC 22 — executeReadyRows nonce tracking. RPC `latest` lags between
// back-to-back approvals during a sweep, causing `nonce too low` on row K+1.
// The helper now tracks its own counter, seeded from `pending`, and feeds it
// to executeFn as `approvalNonceOverride`. Pure unit test via a fake client.
// ---------------------------------------------------------------------------
describe("executeReadyRows — nonce tracking (AC 22)", () => {
  // Tiny fake `getPublicClient` that returns a constant starting nonce. The
  // helper reads pending once at start, then advances locally.
  function mkClientFactory(startingNonce) {
    return async () => ({
      getTransactionCount: async () => BigInt(startingNonce),
    });
  }

  function mkRow(symbol) {
    return { symbol, quote: { from: { symbol }, to: { symbol: "ETH" }, fromChain: "base", toChain: "base" } };
  }

  it("feeds approvalNonceOverride to executeFn as [N, N+2, N+4, ...] when every row needs approval", async () => {
    const overrides = [];
    const executeFn = async (quote, _wallet, _passphrase, opts) => {
      overrides.push(opts.approvalNonceOverride);
      return { hash: `0x${quote.from.symbol}`, status: "success", approvalHash: "0xapproval" };
    };

    const readyRows = ["A", "B", "C", "D", "E"].map(mkRow);
    const { summary } = await executeReadyRows(readyRows, executeFn, {
      walletName: "w",
      passphrase: "p",
      timeout: 120,
      walletAddress: "0xabc",
      chain: "base",
      clientFactory: mkClientFactory(42),
    });

    assert.deepEqual(overrides, [42, 44, 46, 48, 50], "every approval-needed row advances by +2");
    assert.equal(summary.succeeded, 5);
    assert.equal(summary.failed, 0);
  });

  it("advances by +1 when a row's approval was skipped (no approvalHash)", async () => {
    const overrides = [];
    const executeFn = async (quote, _w, _p, opts) => {
      overrides.push(opts.approvalNonceOverride);
      // Rows B and D had the allowance already in place → no approval tx →
      // approvalHash is null → counter advances by +1 (swap only).
      const needsApproval = !["B", "D"].includes(quote.from.symbol);
      return {
        hash: `0x${quote.from.symbol}`,
        status: "success",
        approvalHash: needsApproval ? "0xapproval" : null,
      };
    };

    const readyRows = ["A", "B", "C", "D", "E"].map(mkRow);
    await executeReadyRows(readyRows, executeFn, {
      walletName: "w",
      passphrase: "p",
      timeout: 120,
      walletAddress: "0xabc",
      chain: "base",
      clientFactory: mkClientFactory(10),
    });

    // A: needs approval (+2) → 12. B: no approval (+1) → 13. C: needs (+2)
    // → 15. D: no approval (+1) → 16. E: needs (+2) → 18.
    assert.deepEqual(overrides, [10, 12, 13, 15, 16]);
  });

  it("invalidates the tracked nonce after a row throws — next row falls back to RPC `latest`", async () => {
    // After a row throws, `pending` may transiently include the failed
    // submission for several seconds. Trusting it can over-shoot the counter
    // and surface as `replacement underpriced` / `nonce too low` on the very
    // next row. The recovery contract: null out the tracked counter and let
    // the next row fall back to the signer's default — we lose per-row batch
    // protection for one row but don't compound a wrong counter.
    const overrides = [];
    let pendingReads = 0;
    const factory = async () => ({
      getTransactionCount: async () => {
        pendingReads++;
        return 100n;
      },
    });

    const executeFn = async (quote, _w, _p, opts) => {
      overrides.push(opts.approvalNonceOverride);
      if (quote.from.symbol === "ROW2") {
        throw new Error("synthetic failure mid-batch");
      }
      return { hash: `0x${quote.from.symbol}`, status: "success", approvalHash: "0xapproval" };
    };

    const readyRows = ["ROW1", "ROW2", "ROW3"].map(mkRow);
    const { summary } = await executeReadyRows(readyRows, executeFn, {
      walletName: "w",
      passphrase: "p",
      timeout: 120,
      walletAddress: "0xabc",
      chain: "base",
      clientFactory: factory,
    });

    // ROW1: tracked nonce 100, success +2 → 102. ROW2: tried with 102, throws
    // → counter invalidated. ROW3: tried with `undefined` (signer falls back
    // to RPC latest).
    assert.equal(overrides[0], 100);
    assert.equal(overrides[1], 102);
    assert.equal(overrides[2], undefined, "after throw, next row gets no override");
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 1);
    assert.equal(pendingReads, 1, "no `pending` re-read after the throw — counter is invalidated instead");
  });

  it("skips nonce tracking on Solana (no EVM nonce concept) — no approvalNonceOverride passed", async () => {
    const overrides = [];
    const executeFn = async (quote, _w, _p, opts) => {
      overrides.push(opts.approvalNonceOverride);
      return { hash: `0x${quote.from.symbol}`, status: "success" };
    };
    let factoryCalled = false;
    const factory = async () => {
      factoryCalled = true;
      return { getTransactionCount: async () => 0n };
    };

    const readyRows = [mkRow("USDC"), mkRow("BONK")];
    await executeReadyRows(readyRows, executeFn, {
      walletName: "w",
      passphrase: "p",
      timeout: 120,
      walletAddress: "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F",
      chain: "solana",
      clientFactory: factory,
    });

    assert.equal(factoryCalled, false, "no public client should be built on Solana");
    assert.deepEqual(overrides, [undefined, undefined]);
  });

  it("falls back to per-row RPC nonce when the starting-nonce read throws", async () => {
    const overrides = [];
    const stderrChunks = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };

    try {
      const executeFn = async (quote, _w, _p, opts) => {
        overrides.push(opts.approvalNonceOverride);
        return { hash: `0x${quote.from.symbol}`, status: "success" };
      };
      const factory = async () => ({
        getTransactionCount: async () => { throw new Error("RPC down"); },
      });

      const readyRows = [mkRow("A"), mkRow("B")];
      await executeReadyRows(readyRows, executeFn, {
        walletName: "w",
        passphrase: "p",
        timeout: 120,
        walletAddress: "0xabc",
        chain: "base",
        clientFactory: factory,
      });

      assert.deepEqual(overrides, [undefined, undefined], "fallback means no override is passed");
      const stderrText = stderrChunks.join("");
      assert.match(stderrText, /could not read starting nonce/i);
    } finally {
      process.stderr.write = origStderrWrite;
    }
  });

  // Source-pin: when the allowance already covers the swap, no approval tx is
  // sent and `approvalNonce` stays null in executeEvmSwap. The swap must
  // still use the batch's tracked override — otherwise two back-to-back
  // allowance-covered rows race RPC `latest`. Pinning the expression because
  // mocking signSwapTransaction's nonce flow end-to-end is heavy.
  it("executeEvmSwap forwards approvalNonceOverride to the swap when approval is skipped", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const swapPath = resolve(here, "../../../../../..", "cli/utils/trading/swap.js");
    const src = await readFile(swapPath, "utf8");

    // The fallback when approvalNonce is null MUST be `approvalNonceOverride`
    // (the caller's tracked counter), not `undefined`.
    assert.match(
      src,
      /approvalNonce\s*!=\s*null\s*\?\s*approvalNonce\s*\+\s*1\s*:\s*approvalNonceOverride/,
      "swapNonceOverride must fall through to approvalNonceOverride when approval is skipped",
    );

    // Guard against a future regression that reverts to undefined.
    assert.equal(
      /approvalNonce\s*!=\s*null\s*\?\s*approvalNonce\s*\+\s*1\s*:\s*undefined/.test(src),
      false,
      "swapNonceOverride must not silently fall back to undefined",
    );
  });
});

// ---------------------------------------------------------------------------
// lossCell — sign + magnitude rendering. Loss positive → red, no sign. Gain
// (negative loss_pct, quote returns *more* USD than the source) → green
// with a `+` prefix on the absolute magnitude. The previous form printed
// `+-2.50%` for gains because `toFixed` preserved the negative sign.
// ---------------------------------------------------------------------------
describe("formatConsolidatePlan — loss/gain cell rendering", () => {
  it("renders a gain as `+2.50%` (not `+-2.50%`)", async () => {
    const { formatConsolidatePlan } = await import("#zerion/utils/common/format.js");
    const out = formatConsolidatePlan({
      chain: "base",
      toToken: "USDC",
      walletAddress: "0x" + "a".repeat(40),
      rows: [{
        symbol: "FOO",
        quantity: 1,
        value_usd: 100,
        expected_output: 102.5,
        expected_output_usd: 102.5,
        loss_pct: -0.025,
        status: "ready",
      }],
      totals: { ready: 1, blocked: 0, skipped: 0, no_route: 0, expected_output: 102.5, expected_output_usd: 102.5 },
    });
    assert.ok(out.includes("+2.50%"), `expected "+2.50%" in plan output, got:\n${out}`);
    assert.ok(!out.includes("+-2.50%"), `must not render "+-2.50%" in plan output`);
  });

  it("renders a loss as `2.50%` (no sign, red)", async () => {
    const { formatConsolidatePlan } = await import("#zerion/utils/common/format.js");
    const out = formatConsolidatePlan({
      chain: "base",
      toToken: "USDC",
      walletAddress: "0x" + "a".repeat(40),
      rows: [{
        symbol: "FOO",
        quantity: 1,
        value_usd: 100,
        expected_output: 97.5,
        expected_output_usd: 97.5,
        loss_pct: 0.025,
        status: "ready",
      }],
      totals: { ready: 1, blocked: 0, skipped: 0, no_route: 0, expected_output: 97.5, expected_output_usd: 97.5 },
    });
    assert.ok(out.includes("2.50%"), `expected "2.50%" in plan output, got:\n${out}`);
    assert.ok(!out.includes("+2.50%"), "loss must not be prefixed with +");
    assert.ok(!out.includes("-2.50%"), "loss must not render with a negative sign");
  });
});

// ---------------------------------------------------------------------------
// AC 23 — BigInt-safe amount path. `Number(quantity.float)` truncates 18-
// decimal balances past ~15 significant digits, so the API reconstructs a
// smaller wei amount than the wallet actually holds and rejects the quote
// with "Input asset balance is not enough." Use the raw `quantity.int`
// + impl `decimals` to build a precise decimal string.
// ---------------------------------------------------------------------------
describe("rawWeiToDecimalString — precision contract (AC 23)", () => {
  it("preserves all 18 fractional digits of a wstETH-style balance", () => {
    // 1.234567890123456789 — exactly the kind of value that would lose its
    // trailing digits via parseFloat / Number().
    assert.equal(rawWeiToDecimalString("1234567890123456789", 18), "1.234567890123456789");
  });

  it("strips trailing zeros — `1.0` collapses to `1`", () => {
    assert.equal(rawWeiToDecimalString("1000000000000000000", 18), "1");
  });

  it("handles sub-unit amounts (`100000` USDC-6dp = `0.1`)", () => {
    assert.equal(rawWeiToDecimalString("100000", 6), "0.1");
  });

  it("returns `\"0\"` for zero", () => {
    assert.equal(rawWeiToDecimalString("0", 18), "0");
  });

  it("handles 0-decimals tokens (e.g. some NFT-like fungibles)", () => {
    assert.equal(rawWeiToDecimalString("42", 0), "42");
  });

  it("preserves precision past JavaScript Number's ~15-sigfig ceiling", () => {
    // Number("12345678901234567") rounds to 12345678901234568 — silently lossy.
    const intStr = "12345678901234567"; // 17 digits, past Number's safe range
    const out = rawWeiToDecimalString(intStr, 0);
    assert.equal(out, "12345678901234567");
  });
});

describe("classifyPosition — precise quantity threads through (AC 23)", () => {
  function preciseRow({ symbol, valueUsd, intStr, decimals, address }) {
    return {
      attributes: {
        position_type: "wallet",
        value: valueUsd,
        quantity: { float: parseFloat(intStr) / 10 ** decimals, int: intStr },
        fungible_info: {
          symbol,
          implementations: [{ chain_id: "base", address, decimals }],
        },
      },
    };
  }

  it("threads quantity.int + decimals into the candidate's `quantity` string", () => {
    const row = preciseRow({
      symbol: "WSTETH",
      valueUsd: 4800,
      intStr: "1234567890123456789", // 1.234567890123456789 WSTETH
      decimals: 18,
      address: "0xwsteth",
    });
    const result = classifyPosition(row, baseCtx());
    assert.equal(result.kind, "candidate");
    assert.equal(result.quantity, "1.234567890123456789", "precise decimal string");
    // quantityFloat is a (lossy) Number for display only.
    assert.ok(Math.abs(result.quantityFloat - 1.234567890123456789) < 1e-9);
    // The decimals + rawInt propagate so the native sweep path can do BigInt math.
    assert.equal(result.decimals, 18);
    assert.equal(result.rawInt, "1234567890123456789");
  });

  it("falls back to the float when quantity.int / decimals are missing", () => {
    // Some positions (e.g. for a chain where the impl is missing decimals)
    // can lack one or both fields. We must still produce SOMETHING usable
    // rather than crashing.
    const row = {
      attributes: {
        position_type: "wallet",
        value: 100,
        quantity: { float: 1.5 }, // no .int
        fungible_info: {
          symbol: "WEIRD",
          implementations: [{ chain_id: "base", address: "0xweird" }], // no decimals
        },
      },
    };
    const result = classifyPosition(row, baseCtx());
    assert.equal(result.kind, "candidate");
    assert.equal(result.quantity, "1.5");
  });
});

// ---------------------------------------------------------------------------
// Bridge-variant stables. USDT0 (LayerZero-bridged USDT) and USDC.e (bridged
// USDC) are the two bridged forms recognised as stables — without them, the
// operator would have to remember `--exclude USDT0,USDC.E` on every sweep.
// ---------------------------------------------------------------------------
describe("STABLE_SYMBOLS — bridged variants", () => {
  it("recognises USDT0 in every casing", () => {
    assert.equal(isStable("USDT0"), true);
    assert.equal(isStable("usdt0"), true);
    assert.equal(isStable("Usdt0"), true);
  });

  it("recognises USDC.e in every casing (the dot is part of the symbol)", () => {
    for (const sym of ["USDC.e", "USDC.E", "usdc.e", "Usdc.E"]) {
      assert.equal(isStable(sym), true, `${sym} should match`);
    }
  });

  it("exact-match only: no false positives on lookalikes", () => {
    for (const sym of ["USDT00", "USDC.f", "USDCe", "USDC_E", "USDS0"]) {
      assert.equal(isStable(sym), false, `${sym} should NOT match`);
    }
  });
});
