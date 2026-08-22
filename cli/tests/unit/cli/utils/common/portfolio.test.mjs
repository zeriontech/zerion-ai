// The `/portfolio` endpoint takes no chain filter, so `--chain` has to be
// applied to the total by hand. Getting this wrong reports a wallet-wide number
// above a one-chain position list (WLT-2076).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portfolioTotals } from "#zerion/utils/common/portfolio.js";

const ATTRS = {
  total: { positions: 1_116_026 },
  changes: { absolute_1d: 1746, percent_1d: 0.15 },
  positions_distribution_by_chain: { ethereum: 1_098_324, base: 17_702, zero: 0 },
};

describe("portfolioTotals", () => {
  it("reports the wallet-wide total and 24h change with no chain", () => {
    assert.deepEqual(portfolioTotals(ATTRS, null), { total: 1_116_026, change24h: 1746 });
  });

  it("reports the chain's slice and drops the 24h change", () => {
    // The API publishes changes wallet-wide only — attributing 1746 to base
    // would be an invented number.
    assert.deepEqual(portfolioTotals(ATTRS, "base"), { total: 17_702, change24h: null });
  });

  it("keeps a genuine zero slice distinct from a missing one", () => {
    assert.equal(portfolioTotals(ATTRS, "zero").total, 0);
    assert.equal(portfolioTotals(ATTRS, "arbitrum").total, null);
  });

  it("returns null rather than inventing 0 when the API said nothing", () => {
    assert.deepEqual(portfolioTotals({}, null), { total: null, change24h: null });
    assert.deepEqual(portfolioTotals(undefined, null), { total: null, change24h: null });
    assert.equal(portfolioTotals(undefined, "base").total, null);
  });

  it("never pairs a chain-scoped total with a wallet-wide change", () => {
    for (const chain of ["ethereum", "base", "zero", "unknown-chain"]) {
      assert.equal(portfolioTotals(ATTRS, chain).change24h, null, `chain '${chain}'`);
    }
  });
});
