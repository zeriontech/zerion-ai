import assert from "node:assert/strict";
import { describe, it, after, beforeEach } from "node:test";
import {
  validatePositions,
  resolvePositionFilter,
  resolvePositionFilterForAddress,
  resolveSigningChainAsync,
  resolveReadChainAsync,
  POSITION_FILTERS,
} from "#zerion/utils/common/validate.js";
import { __setCatalogForTests } from "#zerion/utils/chain/catalog.js";

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

describe("resolveSigningChainAsync", () => {
  // Inject a fixture catalog so resolution doesn't hit the network. Includes a
  // chain outside the static 14-chain registry (robinhood) to prove the guard
  // now follows the live catalog, and a catalog entry with no CAIP-2.
  const FIXTURE = new Map([
    ["ethereum", { id: "ethereum", caip2: "eip155:1", chainIdNum: 1 }],
    ["robinhood", { id: "robinhood", caip2: "eip155:42161000", chainIdNum: 42161000 }],
    ["nocaip", { id: "nocaip", caip2: null, chainIdNum: null }],
  ]);
  beforeEach(() => __setCatalogForTests(FIXTURE));

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

describe("resolveReadChainAsync", () => {
  // Read filters need no capability flags and no CAIP-2 — `solana` sits in the
  // catalog with neither, and `robinhood` is outside the static 14-chain registry.
  const FIXTURE = new Map([
    ["ethereum", { id: "ethereum", caip2: "eip155:1", chainIdNum: 1, flags: {} }],
    ["robinhood", { id: "robinhood", caip2: "eip155:42161000", chainIdNum: 42161000, flags: {} }],
    ["solana", { id: "solana", caip2: null, chainIdNum: null, flags: {} }],
  ]);
  beforeEach(() => __setCatalogForTests(FIXTURE));

  after(() => __setCatalogForTests(null));

  it("resolves a chain in the live catalog to its id, no error", async () => {
    const result = await resolveReadChainAsync("ethereum");
    assert.equal(result.error, undefined);
    assert.equal(result.chainId, "ethereum");
  });

  it("resolves a chain outside the static 14-chain registry (robinhood)", async () => {
    const result = await resolveReadChainAsync("robinhood");
    assert.equal(result.error, undefined);
    assert.equal(result.chainId, "robinhood");
  });

  it("accepts a catalog chain with no CAIP-2 or EVM chain ID (solana)", async () => {
    const result = await resolveReadChainAsync("solana");
    assert.equal(result.error, undefined);
    assert.equal(result.chainId, "solana");
  });

  it("errors for a chain not in the catalog", async () => {
    const result = await resolveReadChainAsync("madeupchain");
    assert.equal(result.chainId, undefined);
    assert.equal(result.error.code, "unsupported_chain");
    assert.match(result.error.message, /madeupchain/);
    assert.match(result.error.suggestion, /zerion chains/);
  });

  it("is case-sensitive", async () => {
    const result = await resolveReadChainAsync("Ethereum");
    assert.equal(result.error.code, "unsupported_chain");
  });

  it("errors for boolean true (bare --chain with no value)", async () => {
    const result = await resolveReadChainAsync(true);
    assert.equal(result.error.code, "missing_chain_value");
    assert.match(result.error.message, /--chain requires a value/);
    assert.match(result.error.suggestion, /zerion chains/);
  });

  it("returns a null chain id for falsy values (no filter)", async () => {
    for (const value of [undefined, null, ""]) {
      const result = await resolveReadChainAsync(value);
      assert.equal(result.error, undefined);
      assert.equal(result.chainId, null);
    }
  });
});

// The Zerion API has no protocol positions for Solana yet: `/positions/` 400s
// on both `no_filter` and `only_complex` for base58 addresses. This helper is
// the single place that decides what to send (WLT-2076).
describe("resolvePositionFilterForAddress", () => {
  const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const SOL = "ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY";

  it("leaves every filter untouched for EVM addresses", () => {
    assert.deepEqual(resolvePositionFilterForAddress(EVM, undefined), { filter: "no_filter" });
    assert.deepEqual(resolvePositionFilterForAddress(EVM, "all"), { filter: "no_filter" });
    assert.deepEqual(resolvePositionFilterForAddress(EVM, "simple"), { filter: "only_simple" });
    assert.deepEqual(resolvePositionFilterForAddress(EVM, "defi"), { filter: "only_complex" });
  });

  it("downgrades an implicit 'everything' to only_simple on Solana, with a note", () => {
    const result = resolvePositionFilterForAddress(SOL, undefined);
    assert.equal(result.filter, "only_simple");
    assert.match(result.note, /Solana/);
    assert.equal(result.error, undefined);
  });

  it("downgrades an explicit --positions all the same way", () => {
    assert.equal(resolvePositionFilterForAddress(SOL, "all").filter, "only_simple");
  });

  it("passes --positions simple through without a note", () => {
    assert.deepEqual(resolvePositionFilterForAddress(SOL, "simple"), { filter: "only_simple" });
  });

  it("refuses an explicit DeFi ask on Solana rather than silently substituting", () => {
    const result = resolvePositionFilterForAddress(SOL, "defi");
    assert.equal(result.filter, undefined);
    assert.equal(result.error.code, "solana_defi_unsupported");
    assert.match(result.error.suggestion, /EVM address/);
  });

  it("never returns a filter the Solana endpoint rejects", () => {
    for (const flag of [undefined, "all", "simple", "defi"]) {
      const { filter } = resolvePositionFilterForAddress(SOL, flag);
      if (filter) assert.equal(filter, "only_simple", `flag '${flag}' produced '${filter}'`);
    }
  });
});
