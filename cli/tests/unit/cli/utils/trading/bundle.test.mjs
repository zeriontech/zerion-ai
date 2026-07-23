// Unit coverage for the pure bundle logic: input normalisation, same-signer
// invariant, strictest-wins routing, aggregate-outflow math, freshness
// heuristic, and status roll-up.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeGroupInputs,
  assertSameSigner,
  decideBundleRoute,
  aggregateOutflows,
  matchPositionBalance,
  quoteFreshnessWarnings,
  computeBundleStatus,
} from "#zerion/utils/trading/bundle.js";

const evmGroup = (over = {}) => ({
  ecosystem: "evm",
  chain: "base",
  address: "0xAbCdEf0000000000000000000000000000000001",
  route: "local",
  outflows: [],
  transactions: [{ evm: { to: "0x1" } }],
  ...over,
});

describe("normalizeGroupInputs", () => {
  it("wraps a single string", () => {
    assert.deepEqual(normalizeGroupInputs("a"), ["a"]);
  });
  it("passes an array through, dropping bare/boolean occurrences", () => {
    assert.deepEqual(normalizeGroupInputs(["a", true, "b", ""]), ["a", "b"]);
  });
  it("throws when nothing usable is passed", () => {
    assert.throws(() => normalizeGroupInputs(undefined), /at least one --group/);
    assert.throws(() => normalizeGroupInputs(true), /at least one --group/);
  });
});

describe("assertSameSigner", () => {
  it("accepts matching signers (EVM case-insensitive) across differing chains", () => {
    const out = assertSameSigner([
      evmGroup({ chain: "base" }),
      evmGroup({ chain: "arbitrum", address: "0xabcdef0000000000000000000000000000000001" }),
    ]);
    assert.equal(out.ecosystem, "evm");
    assert.equal(out.address, "0xAbCdEf0000000000000000000000000000000001");
  });
  it("rejects mixed addresses", () => {
    assert.throws(
      () => assertSameSigner([evmGroup(), evmGroup({ address: "0x0000000000000000000000000000000000000002" })]),
      /share one signer address/,
    );
  });
  it("rejects mixed ecosystems", () => {
    assert.throws(
      () => assertSameSigner([evmGroup(), evmGroup({ ecosystem: "solana", address: "SoLaNa111" })]),
      /share one signer/,
    );
  });
});

describe("decideBundleRoute (strictest-wins)", () => {
  it("routes the whole queue to web-app if ANY group is web-app", () => {
    assert.equal(decideBundleRoute([evmGroup(), evmGroup({ route: "web-app" })]), "web-app");
  });
  it("routes local only when ALL groups are local", () => {
    assert.equal(decideBundleRoute([evmGroup(), evmGroup()]), "local");
  });
});

describe("aggregateOutflows", () => {
  it("sums the same token on the same chain across groups", () => {
    const groups = [
      evmGroup({ outflows: [{ chain: "base", symbol: "USDC", tokenAddress: "0xUSDC", amount: "10" }] }),
      evmGroup({ outflows: [{ chain: "base", symbol: "USDC", tokenAddress: "0xusdc", amount: "20" }] }),
    ];
    const agg = aggregateOutflows(groups);
    assert.equal(agg.length, 1);
    assert.equal(agg[0].amount, 30);
  });
  it("keeps different chains / native separate", () => {
    const groups = [
      evmGroup({ outflows: [{ chain: "base", symbol: "ETH", amount: "1", native: true }] }),
      evmGroup({ outflows: [{ chain: "arbitrum", symbol: "ETH", amount: "1", native: true }] }),
    ];
    assert.equal(aggregateOutflows(groups).length, 2);
  });
});

describe("matchPositionBalance", () => {
  const positions = [
    { attributes: { position_type: "wallet", quantity: { float: 25 }, fungible_info: { symbol: "USDC", implementations: [{ chain_id: "base", address: "0xUSDC" }] } } },
    { attributes: { position_type: "wallet", quantity: { float: 5 }, fungible_info: { symbol: "ETH", implementations: [] } } },
  ];
  it("matches by on-chain address", () => {
    assert.equal(matchPositionBalance(positions, { symbol: "USDC", tokenAddress: "0xusdc" }), 25);
  });
  it("matches native by symbol when no address", () => {
    assert.equal(matchPositionBalance(positions, { symbol: "ETH", tokenAddress: null, native: true }), 5);
  });
  it("returns null when nothing matches", () => {
    assert.equal(matchPositionBalance(positions, { symbol: "DAI", tokenAddress: "0xdai" }), null);
  });
});

describe("quoteFreshnessWarnings", () => {
  const nowMs = Date.parse("2026-07-22T00:05:00.000Z");
  it("warns for stale groups only", () => {
    const groups = [
      { preparedAt: "2026-07-22T00:04:55.000Z" }, // 5s — fresh
      { preparedAt: "2026-07-22T00:00:00.000Z" }, // 300s — stale
    ];
    const warns = quoteFreshnessWarnings(groups, { nowMs, maxAgeSeconds: 120 });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /group #2/);
  });
});

describe("computeBundleStatus", () => {
  it("completed only when every group completed", () => {
    assert.equal(computeBundleStatus(["completed", "completed"]), "completed");
  });
  it("partial when some completed and some not", () => {
    assert.equal(computeBundleStatus(["completed", "failed"]), "partial");
    assert.equal(computeBundleStatus(["completed", "rejected"]), "partial");
  });
  it("rejected/failed when none completed", () => {
    assert.equal(computeBundleStatus(["rejected", "rejected"]), "rejected");
    assert.equal(computeBundleStatus(["failed", "rejected"]), "failed");
  });
  it("failed on empty", () => {
    assert.equal(computeBundleStatus([]), "failed");
  });
});
