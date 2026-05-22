// Unit tests for the consolidate target-token resolver. The resolver replaces
// the old searchFungibles+symbol-filter path. Two accepted input shapes:
//   1. curated symbol → look up the canonical Zerion fungible id, then
//      pick its impl on the target chain
//   2. raw contract address (EVM 0x… or Solana base58) → resolve via API
// Anything else throws target_token_not_found.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TARGET_FUNGIBLE_IDS,
  isAddressInput,
  getCuratedFungibleId,
  listCuratedSymbols,
  resolveTargetToken,
} from "#zerion/utils/trading/consolidate-targets.js";

// Fake API. `getFungible(id)` returns whatever fixture is keyed by id;
// `searchFungibles(query, {chainId})` returns the first match keyed by
// (chain, lowercased address).
function makeApi({ getFungibles = {}, search = {}, unknownAddresses = new Set() } = {}) {
  return {
    async getFungible(id) {
      const data = getFungibles[id];
      return data ? { data } : { data: null };
    },
    async searchFungibles(query, options = {}) {
      const chain = options.chainId;
      const addr = String(query).toLowerCase();
      if (unknownAddresses.has(addr)) return { data: [] };
      const fungible = search[chain]?.[addr];
      return { data: fungible ? [fungible] : [] };
    },
  };
}

function makeFungible({ id, symbol, impls, price = 1.0 }) {
  return {
    id,
    attributes: {
      symbol,
      market_data: { price },
      implementations: impls.map(([chain_id, address, decimals = 18]) => ({
        chain_id,
        address,
        decimals,
      })),
    },
  };
}

function noNative() {
  return async () => null;
}

describe("isAddressInput", () => {
  it("recognizes EVM 0x… addresses on non-solana chains", () => {
    assert.equal(isAddressInput("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "ethereum"), true);
    assert.equal(isAddressInput("0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", "ethereum"), true);
  });

  it("rejects 0x-prefixed but wrong-length inputs", () => {
    assert.equal(isAddressInput("0xabc", "ethereum"), false);
  });

  it("rejects pure symbols", () => {
    assert.equal(isAddressInput("USDC", "ethereum"), false);
    assert.equal(isAddressInput("USDC.e", "polygon"), false);
  });

  it("recognizes Solana base58 mints on the solana chain", () => {
    assert.equal(isAddressInput("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "solana"), true);
  });

  it("rejects empty / nullish input", () => {
    assert.equal(isAddressInput("", "ethereum"), false);
    assert.equal(isAddressInput(null, "ethereum"), false);
    assert.equal(isAddressInput(undefined, "ethereum"), false);
  });
});

describe("TARGET_FUNGIBLE_IDS shape", () => {
  it("is a flat symbol→fungibleId map (one id per asset, not per chain)", () => {
    for (const [symbol, id] of Object.entries(TARGET_FUNGIBLE_IDS)) {
      assert.equal(typeof id, "string", `${symbol} id must be a string`);
      assert.ok(id.length > 0, `${symbol} id must be non-empty`);
      // The convention in this codebase uses the Ethereum-mainnet address as
      // the canonical fungible id for ERC-20-rooted assets.
      assert.match(id, /^0x[a-fA-F0-9]{40}$/, `${symbol} id is not a 0x address`);
    }
  });

  it("contains the canonical bluechips", () => {
    for (const sym of ["USDC", "USDT", "DAI", "WETH", "WBTC"]) {
      assert.ok(TARGET_FUNGIBLE_IDS[sym], `${sym} missing from curated map`);
    }
  });

  it("does NOT contain bridged-variant symbols (USDC.e, etc.)", () => {
    for (const symbol of Object.keys(TARGET_FUNGIBLE_IDS)) {
      assert.ok(!symbol.toUpperCase().includes(".E"), `${symbol} looks like a bridged variant`);
    }
  });
});

describe("getCuratedFungibleId", () => {
  it("looks up by uppercase symbol", () => {
    assert.equal(
      getCuratedFungibleId("USDC"),
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("returns null for unknown symbols", () => {
    assert.equal(getCuratedFungibleId("USDC.E"), null);
    assert.equal(getCuratedFungibleId("PEPE"), null);
  });
});

describe("listCuratedSymbols", () => {
  it("returns the sorted list of curated symbols", () => {
    const symbols = listCuratedSymbols();
    assert.deepEqual([...symbols].sort(), symbols);
    assert.ok(symbols.includes("USDC"));
    assert.ok(symbols.includes("WETH"));
  });
});

describe("resolveTargetToken — curated symbol path", () => {
  it("fetches by fungible id and picks the impl Zerion reports for this chain", async () => {
    // Zerion's USDC fungible advertises one impl per chain. Whatever address
    // it returns for polygon is what we target — bridged USDC.e or native
    // Circle USDC, whichever Zerion considers canonical.
    const usdcId = TARGET_FUNGIBLE_IDS.USDC;
    const fungible = makeFungible({
      id: usdcId,
      symbol: "USDC",
      price: 1.0001,
      impls: [
        ["ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6],
        ["polygon",  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", 6], // USDC.e
        ["base",     "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6],
      ],
    });
    const api = makeApi({ getFungibles: { [usdcId]: fungible } });

    const onPolygon = await resolveTargetToken({
      toToken: "USDC",
      chain: "polygon",
      api,
      getNativeFungible: noNative(),
    });
    // Whatever Zerion lists as USDC's polygon impl is the address we target,
    // even if it's the bridged variant — that's the whole point of trusting
    // the API for per-chain impls.
    assert.equal(onPolygon.symbol, "USDC");
    assert.equal(onPolygon.address, "0x2791bca1f2de4661ed88a30c99a7a9449aa84174");
    assert.equal(onPolygon.usdPrice, 1.0001);
    assert.equal(onPolygon.fungibleId, usdcId);

    const onBase = await resolveTargetToken({
      toToken: "USDC",
      chain: "base",
      api,
      getNativeFungible: noNative(),
    });
    assert.equal(onBase.address, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("normalizes lowercase symbol input (usdc → USDC)", async () => {
    const usdcId = TARGET_FUNGIBLE_IDS.USDC;
    const fungible = makeFungible({
      id: usdcId,
      symbol: "USDC",
      impls: [["base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6]],
    });
    const api = makeApi({ getFungibles: { [usdcId]: fungible } });
    const result = await resolveTargetToken({
      toToken: "usdc",
      chain: "base",
      api,
      getNativeFungible: noNative(),
    });
    assert.equal(result.symbol, "USDC");
  });

  it("keeps the user's symbol (not the API's) so position-side exclusion matches", async () => {
    // If Zerion's `attributes.symbol` is "USD Coin" or "USDC.e", positions
    // still expose "USDC" as their symbol — we must use the user's intent
    // for the symbol-based exclusion to work.
    const usdcId = TARGET_FUNGIBLE_IDS.USDC;
    const fungible = makeFungible({
      id: usdcId,
      symbol: "USD Coin", // API name drift
      impls: [["ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6]],
    });
    const api = makeApi({ getFungibles: { [usdcId]: fungible } });
    const result = await resolveTargetToken({
      toToken: "USDC",
      chain: "ethereum",
      api,
      getNativeFungible: noNative(),
    });
    assert.equal(result.symbol, "USDC");
  });

  it("throws target_token_not_found when the curated fungible has no impl on the chain", async () => {
    const wbtcId = TARGET_FUNGIBLE_IDS.WBTC;
    const fungible = makeFungible({
      id: wbtcId,
      symbol: "WBTC",
      impls: [["ethereum", "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", 8]],
    });
    const api = makeApi({ getFungibles: { [wbtcId]: fungible } });
    await assert.rejects(
      resolveTargetToken({ toToken: "WBTC", chain: "solana", api, getNativeFungible: noNative() }),
      (err) => {
        assert.equal(err.code, "target_token_not_found");
        return true;
      },
    );
  });
});

describe("resolveTargetToken — address path", () => {
  it("accepts a raw 0x address and resolves it via searchFungibles", async () => {
    const fixture = makeFungible({
      id: "id-some-token",
      symbol: "PEPE",
      price: 0.000012,
      impls: [["ethereum", "0x6982508145454ce325ddbe47a25d4ec3d2311933", 18]],
    });
    const api = makeApi({
      search: { ethereum: { "0x6982508145454ce325ddbe47a25d4ec3d2311933": fixture } },
    });

    const result = await resolveTargetToken({
      toToken: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
      chain: "ethereum",
      api,
      getNativeFungible: noNative(),
    });

    assert.equal(result.symbol, "PEPE");
    assert.equal(result.address, "0x6982508145454ce325ddbe47a25d4ec3d2311933");
    assert.equal(result.fungibleId, "id-some-token");
  });

  it("lowercases mixed-case addresses before lookup", async () => {
    const lower = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
    const fixture = makeFungible({
      id: "id-x",
      symbol: "PEPE",
      impls: [["ethereum", lower, 18]],
    });
    const api = makeApi({ search: { ethereum: { [lower]: fixture } } });

    const result = await resolveTargetToken({
      toToken: "0x6982508145454CE325DDBE47A25D4EC3D2311933",
      chain: "ethereum",
      api,
      getNativeFungible: noNative(),
    });
    assert.equal(result.address, lower);
  });

  it("lets the user reach a bridged variant by passing its address", async () => {
    // Curated USDC on polygon would point at whichever impl Zerion lists.
    // If the user wants the OTHER variant (e.g. Circle-native USDC at 0x3c…
    // when Zerion's USDC returns USDC.e), they pass the address explicitly.
    const nativeUsdc = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
    const fixture = makeFungible({
      id: "polygon-native-usdc-fungible",
      symbol: "USDC",
      impls: [["polygon", nativeUsdc, 6]],
    });
    const api = makeApi({ search: { polygon: { [nativeUsdc]: fixture } } });

    const result = await resolveTargetToken({
      toToken: nativeUsdc,
      chain: "polygon",
      api,
      getNativeFungible: noNative(),
    });
    assert.equal(result.address, nativeUsdc);
    assert.equal(result.fungibleId, "polygon-native-usdc-fungible");
  });
});

describe("resolveTargetToken — rejection path", () => {
  it("throws target_token_not_found for unknown symbols", async () => {
    const api = makeApi();
    await assert.rejects(
      resolveTargetToken({
        toToken: "USDC.E",
        chain: "polygon",
        api,
        getNativeFungible: noNative(),
      }),
      (err) => {
        assert.equal(err.code, "target_token_not_found");
        assert.match(err.message, /USDC\.E/);
        assert.match(err.message, /polygon/);
        // The error must name the curated list so the user can self-correct
        assert.match(err.message, /USDC/);
        assert.ok(err.suggestion, "suggestion should be populated");
        return true;
      },
    );
  });

  it("throws target_token_not_found when an address has no impl on the chain", async () => {
    const unknown = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const api = makeApi({ unknownAddresses: new Set([unknown]) });
    await assert.rejects(
      resolveTargetToken({
        toToken: unknown,
        chain: "polygon",
        api,
        getNativeFungible: noNative(),
      }),
      (err) => {
        assert.equal(err.code, "target_token_not_found");
        return true;
      },
    );
  });

  it("error names every curated symbol so the user knows the full list", async () => {
    const api = makeApi();
    try {
      await resolveTargetToken({
        toToken: "FAKE",
        chain: "ethereum",
        api,
        getNativeFungible: noNative(),
      });
      assert.fail("expected throw");
    } catch (err) {
      for (const sym of ["USDC", "USDT", "DAI", "WETH", "WBTC"]) {
        assert.match(err.message, new RegExp(sym));
      }
    }
  });
});

describe("resolveTargetToken — native token path", () => {
  it("matches the chain's native symbol via getNativeFungible + getFungible (for price)", async () => {
    const api = makeApi({
      getFungibles: {
        "eth-fungible-id": {
          id: "eth-fungible-id",
          attributes: { symbol: "ETH", market_data: { price: 2500.42 }, implementations: [] },
        },
      },
    });
    const getNativeFungible = async (chain) => {
      assert.equal(chain, "base");
      return { fungibleId: "eth-fungible-id", symbol: "ETH", name: "Ethereum", decimals: 18 };
    };

    const result = await resolveTargetToken({
      toToken: "ETH",
      chain: "base",
      api,
      getNativeFungible,
    });

    assert.equal(result.symbol, "ETH");
    assert.equal(result.address, null, "native address should be null so only symbol exclusion fires");
    assert.equal(result.usdPrice, 2500.42);
    assert.equal(result.fungibleId, "eth-fungible-id");
  });

  it("native lookup is best-effort — falls through to curated/address paths if it throws", async () => {
    const usdcId = TARGET_FUNGIBLE_IDS.USDC;
    const fungible = makeFungible({
      id: usdcId,
      symbol: "USDC",
      impls: [["polygon", "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", 6]],
    });
    const api = makeApi({ getFungibles: { [usdcId]: fungible } });
    const getNativeFungible = async () => {
      throw new Error("catalog rate limit");
    };

    const result = await resolveTargetToken({
      toToken: "USDC",
      chain: "polygon",
      api,
      getNativeFungible,
    });
    assert.equal(result.symbol, "USDC");
    assert.equal(result.address, "0x2791bca1f2de4661ed88a30c99a7a9449aa84174");
  });

  it("does NOT take the native path when input is an address (even if it matches the native symbol)", async () => {
    const fixture = makeFungible({
      id: "weth",
      symbol: "WETH",
      impls: [["base", "0x4200000000000000000000000000000000000006", 18]],
    });
    const api = makeApi({ search: { base: { "0x4200000000000000000000000000000000000006": fixture } } });
    let nativeCalled = false;
    const getNativeFungible = async () => {
      nativeCalled = true;
      return { fungibleId: "eth", symbol: "ETH", decimals: 18 };
    };

    const result = await resolveTargetToken({
      toToken: "0x4200000000000000000000000000000000000006",
      chain: "base",
      api,
      getNativeFungible,
    });
    assert.equal(nativeCalled, false, "native path must not run for address inputs");
    assert.equal(result.symbol, "WETH");
  });
});
