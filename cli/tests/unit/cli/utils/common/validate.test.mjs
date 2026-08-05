import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import {
  validateChain,
  validatePositions,
  resolvePositionFilter,
  resolveSigningChainAsync,
  CHAIN_IDS,
  POSITION_FILTERS,
} from "#zerion/utils/common/validate.js";
import { __setCatalogForTests } from "#zerion/utils/chain/catalog.js";

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

describe("resolveSigningChainAsync", () => {
  // Inject a fixture catalog so resolution doesn't hit the network. Includes a
  // chain outside the static 14-chain registry (robinhood) to prove the guard
  // now follows the live catalog, and a catalog entry with no CAIP-2.
  const FIXTURE = new Map([
    ["ethereum", { id: "ethereum", caip2: "eip155:1", chainIdNum: 1 }],
    ["robinhood", { id: "robinhood", caip2: "eip155:42161000", chainIdNum: 42161000 }],
    ["nocaip", { id: "nocaip", caip2: null, chainIdNum: null }],
  ]);
  __setCatalogForTests(FIXTURE);

  after(() => __setCatalogForTests(null));

  it("resolves a chain in the live catalog to its CAIP-2, no error", async () => {
    const result = await resolveSigningChainAsync("ethereum");
    assert.equal(result.error, undefined);
    assert.equal(result.caip2, "eip155:1");
  });

  it("resolves a chain outside the static 14-chain registry (robinhood)", async () => {
    const result = await resolveSigningChainAsync("robinhood");
    assert.equal(result.error, undefined);
    assert.equal(result.caip2, "eip155:42161000");
  });

  it("keeps Solana's static ed25519 network id without hitting the catalog", async () => {
    const result = await resolveSigningChainAsync("solana");
    assert.equal(result.error, undefined);
    assert.match(result.caip2, /^solana:/);
  });

  it("errors for a chain not in the catalog", async () => {
    const result = await resolveSigningChainAsync("madeupchain");
    assert.equal(result.caip2, undefined);
    assert.equal(result.error.code, "unsupported_chain");
    assert.match(result.error.message, /madeupchain/);
    assert.match(result.error.suggestion, /zerion chains/);
  });

  it("errors for a catalog chain that carries no CAIP-2", async () => {
    const result = await resolveSigningChainAsync("nocaip");
    assert.equal(result.error.code, "unsupported_chain");
  });

  it("returns a null CAIP-2 for a falsy chain (no validation)", async () => {
    const result = await resolveSigningChainAsync(undefined);
    assert.equal(result.error, undefined);
    assert.equal(result.caip2, null);
  });
});
