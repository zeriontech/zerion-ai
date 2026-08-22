import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeAnalyze } from "#zerion/utils/common/analyze.js";

describe("summarizeAnalyze", () => {
  it("returns all fields for full valid data", () => {
    const portfolio = { data: { attributes: { total: { positions: 50000 }, changes: { absolute_1d: -100, percent_1d: -0.2 }, positions_distribution_by_chain: { ethereum: 45000, base: 5000 } } } };
    const positions = { data: [
      { attributes: { fungible_info: { name: "Ether", symbol: "ETH" }, value: 40000, quantity: { float: 20 } }, relationships: { chain: { data: { id: "ethereum" } } } },
      { attributes: { fungible_info: { name: "USD Coin", symbol: "USDC" }, value: 10000, quantity: { float: 10000 } }, relationships: { chain: { data: { id: "base" } } } }
    ] };
    const transactions = { data: [{ attributes: { hash: "0x123", status: "confirmed", mined_at: "2026-01-01", operation_type: "trade", fee: { value: 0.01 }, transfers: [{ direction: "out", fungible_info: { name: "Ether", symbol: "ETH" }, quantity: { float: 1 }, value: 2000 }] } }] };
    const pnl = { data: { attributes: { realized: 100 } } };

    const result = summarizeAnalyze("0xABC", portfolio, positions, transactions, pnl);

    assert.equal(result.wallet.query, "0xABC");
    assert.equal(result.portfolio.total, 50000);
    assert.equal(result.portfolio.currency, "usd");
    assert.deepEqual(result.portfolio.chains, { ethereum: 45000, base: 5000 });
    assert.equal(result.positions.count, 2);
    assert.equal(result.positions.top.length, 2);
    assert.equal(result.positions.top[0].name, "Ether");
    assert.equal(result.transactions.sampled, 1);
    assert.equal(result.transactions.recent.length, 1);
    assert.equal(result.transactions.recent[0].hash, "0x123");
    assert.equal(result.pnl.available, true);
    assert.deepEqual(result.pnl.summary, { realized: 100 });
    assert.equal(result.raw, undefined);
  });

  it("handles all null/undefined responses gracefully", () => {
    const result = summarizeAnalyze("0xABC", null, null, null, null);

    assert.equal(result.portfolio.total, null);
    assert.equal(result.positions.count, 0);
    assert.equal(result.transactions.sampled, 0);
    assert.equal(result.pnl.available, false);
    assert.equal(result.pnl.summary, null);
  });

  it("handles non-array positions.data", () => {
    const result = summarizeAnalyze("0xABC", null, { data: "not-array" }, null, null);
    assert.equal(result.positions.count, 0);
  });

  it("handles missing nested attributes", () => {
    const portfolio = { data: { attributes: {} } };
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null);
    assert.equal(result.portfolio.total, null);
  });

  it("passes address through to query", () => {
    const result = summarizeAnalyze("vitalik.eth", null, null, null, null);
    assert.equal(result.wallet.query, "vitalik.eth");
  });
});

// `analyze --chain X` filters the positions and transactions legs, but the
// /portfolio endpoint takes no chain filter — so the total has to be sliced the
// same way `portfolio` slices it, or the summary reports a wallet-wide number
// over a one-chain list (WLT-2076).
describe("summarizeAnalyze — --chain scoping", () => {
  const portfolio = { data: { attributes: {
    total: { positions: 50000 },
    changes: { absolute_1d: -100, percent_1d: -0.2 },
    positions_distribution_by_chain: { ethereum: 45000, base: 5000 },
  } } };

  it("reports the chain's slice as the total", () => {
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null, { chainId: "base" });
    assert.equal(result.portfolio.total, 5000);
    assert.equal(result.portfolio.chain, "base");
  });

  it("drops the 24h change when scoped to a chain", () => {
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null, { chainId: "base" });
    assert.equal(result.portfolio.change_1d, null);
  });

  it("keeps the full chain distribution so the rest is still visible", () => {
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null, { chainId: "base" });
    assert.deepEqual(result.portfolio.chains, { ethereum: 45000, base: 5000 });
  });

  it("is unchanged with no chain: wallet-wide total, change present, no chain key", () => {
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null);
    assert.equal(result.portfolio.total, 50000);
    assert.deepEqual(result.portfolio.change_1d, { absolute_1d: -100, percent_1d: -0.2 });
    assert.equal("chain" in result.portfolio, false);
  });

  it("reports null, not the wallet total, for a chain the wallet is absent from", () => {
    const result = summarizeAnalyze("0xABC", portfolio, null, null, null, { chainId: "arbitrum" });
    assert.equal(result.portfolio.total, null);
  });
});
