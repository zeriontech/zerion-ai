import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateChain,
  validatePositions,
  resolvePositionFilter,
  CHAIN_IDS,
  POSITION_FILTERS,
} from "#zerion/utils/util/validate.js";

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
