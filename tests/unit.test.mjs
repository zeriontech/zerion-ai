import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlags } from "../cli/lib/flags.js";
import { basicAuthHeader } from "../cli/lib/api-client.js";
import { validateChain, validatePositions, resolvePositionFilter, CHAIN_IDS, POSITION_FILTERS } from "../cli/lib/validate.js";
import { summarizeAnalyze } from "../cli/lib/analyze.js";

describe("parseFlags", () => {
  it("returns empty rest and flags for empty argv", () => {
    const result = parseFlags([]);
    assert.deepEqual(result, { rest: [], flags: {} });
  });

  it("collects positional args into rest", () => {
    const result = parseFlags(["wallet", "analyze", "0xABC"]);
    assert.deepEqual(result.rest, ["wallet", "analyze", "0xABC"]);
    assert.deepEqual(result.flags, {});
  });

  it("parses --key value (space-separated)", () => {
    const result = parseFlags(["--chain", "ethereum"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("parses --key=value (equals-separated)", () => {
    const result = parseFlags(["--chain=ethereum"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("parses --flag alone as boolean true", () => {
    const result = parseFlags(["--help"]);
    assert.equal(result.flags.help, true);
  });

  it("handles mixed positional args and flags", () => {
    const result = parseFlags(["wallet", "positions", "0xABC", "--chain", "ethereum"]);
    assert.deepEqual(result.rest, ["wallet", "positions", "0xABC"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("handles --flag1 --flag2 value (flag1 is boolean, flag2 has value)", () => {
    const result = parseFlags(["--verbose", "--chain", "ethereum"]);
    assert.equal(result.flags.verbose, true);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("handles --key= as empty string value", () => {
    const result = parseFlags(["--chain="]);
    assert.equal(result.flags.chain, "");
  });

  it("preserves full value with --key=a=b (splits on first = only)", () => {
    const result = parseFlags(["--url=https://a.com?k=v"]);
    assert.equal(result.flags.url, "https://a.com?k=v");
  });

  it("last duplicate flag wins", () => {
    const result = parseFlags(["--chain", "ethereum", "--chain", "base"]);
    assert.equal(result.flags.chain, "base");
  });

  it("treats -h (single dash) as positional arg, not flag", () => {
    const result = parseFlags(["-h"]);
    assert.deepEqual(result.rest, ["-h"]);
    assert.deepEqual(result.flags, {});
  });
});

describe("basicAuthHeader", () => {
  it("produces correct Base64 for a normal key", () => {
    const header = basicAuthHeader("zk_dev_abc");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "zk_dev_abc:");
  });

  it("produces correct header for empty string", () => {
    const header = basicAuthHeader("");
    assert.equal(header, "Basic Og==");
    const decoded = Buffer.from("Og==", "base64").toString();
    assert.equal(decoded, ":");
  });

  it("handles special characters in key", () => {
    const header = basicAuthHeader("key+with/special=chars");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "key+with/special=chars:");
  });
});

describe("validateChain", () => {
  it("returns null for each valid chain", () => {
    for (const chain of CHAIN_IDS) {
      assert.equal(validateChain(chain), null, `Expected null for valid chain '${chain}'`);
    }
  });

  it("returns error for invalid chain", () => {
    const result = validateChain("fantom");
    assert.equal(result.code, "unsupported_chain");
    assert.match(result.message, /fantom/);
    assert.ok(Array.isArray(result.supportedChains));
  });

  it("is case-sensitive", () => {
    const result = validateChain("Ethereum");
    assert.equal(result.code, "unsupported_chain");
  });

  it("returns null for falsy values (undefined, null, empty string)", () => {
    assert.equal(validateChain(undefined), null);
    assert.equal(validateChain(null), null);
    assert.equal(validateChain(""), null);
  });

  it("returns specific error for boolean true (from --chain with no value)", () => {
    const result = validateChain(true);
    assert.equal(result.code, "missing_chain_value");
    assert.match(result.message, /--chain requires a value/);
  });
});

describe("POSITION_FILTERS", () => {
  it("has 3 keys mapping correctly", () => {
    assert.equal(Object.keys(POSITION_FILTERS).length, 3);
    assert.equal(POSITION_FILTERS.all, "no_filter");
    assert.equal(POSITION_FILTERS.simple, "only_simple");
    assert.equal(POSITION_FILTERS.defi, "only_complex");
  });
});

describe("validatePositions", () => {
  it("returns null for each valid value", () => {
    for (const key of Object.keys(POSITION_FILTERS)) {
      assert.equal(validatePositions(key), null, `Expected null for valid value '${key}'`);
    }
  });

  it("returns error for invalid value", () => {
    const result = validatePositions("bogus");
    assert.equal(result.code, "unsupported_positions_filter");
    assert.match(result.message, /bogus/);
    assert.ok(Array.isArray(result.supportedValues));
  });

  it("returns specific error for boolean true (bare --positions)", () => {
    const result = validatePositions(true);
    assert.equal(result.code, "missing_positions_value");
    assert.match(result.message, /--positions requires a value/);
    assert.ok(Array.isArray(result.supportedValues));
  });

  it("returns null for falsy values", () => {
    assert.equal(validatePositions(undefined), null);
    assert.equal(validatePositions(null), null);
    assert.equal(validatePositions(""), null);
  });
});

describe("resolvePositionFilter", () => {
  it("maps each value correctly", () => {
    assert.equal(resolvePositionFilter("all"), "no_filter");
    assert.equal(resolvePositionFilter("simple"), "only_simple");
    assert.equal(resolvePositionFilter("defi"), "only_complex");
  });

  it("defaults to no_filter for undefined", () => {
    assert.equal(resolvePositionFilter(undefined), "no_filter");
  });
});

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

describe("CHAIN_IDS", () => {
  it("contains 14 chains", () => {
    assert.equal(CHAIN_IDS.size, 14);
  });

  it("includes key chains", () => {
    for (const chain of ["ethereum", "base", "arbitrum", "solana", "polygon"]) {
      assert.ok(CHAIN_IDS.has(chain), `Missing chain: ${chain}`);
    }
  });
});
