// "ETH" must only resolve to the native asset on chains whose native coin is
// ETH. On polygon (POL), bsc (BNB), etc. it has to come back as a token so
// `send` builds an ERC-20 transfer (or fails with no_contract) instead of a
// native transfer of the other coin. Stubs fetch for the chain catalog and the
// native-fungible lookups.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resolveToken } from "#zerion/utils/trading/resolve-token.js";
import { __setCatalogForTests } from "#zerion/utils/chain/catalog.js";
import { NATIVE_ASSET_ADDRESS } from "#zerion/utils/common/constants.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ZERION_API_KEY;

const CHAINS_FIXTURE = {
  data: [
    {
      id: "polygon",
      attributes: {
        name: "Polygon",
        external_id: "0x89",
        flags: { supports_trading: true, supports_bridge: true, supports_sending: true },
      },
      relationships: { native_fungible: { data: { id: "polygon-native" } } },
    },
    {
      id: "base",
      attributes: {
        name: "Base",
        external_id: "0x2105",
        flags: { supports_trading: true, supports_bridge: true, supports_sending: true },
      },
      relationships: { native_fungible: { data: { id: "eth" } } },
    },
  ],
};

const FUNGIBLES_FIXTURE = {
  "polygon-native": {
    data: {
      id: "polygon-native",
      attributes: {
        symbol: "POL",
        name: "Polygon Ecosystem Token",
        implementations: [{ chain_id: "polygon", address: null, decimals: 18 }],
      },
    },
  },
  eth: {
    data: {
      id: "eth",
      attributes: {
        symbol: "ETH",
        name: "Ethereum",
        implementations: [
          { chain_id: "ethereum", address: null, decimals: 18 },
          { chain_id: "base", address: null, decimals: 18 },
        ],
      },
    },
  },
};

beforeEach(() => {
  __setCatalogForTests(null);
  process.env.ZERION_API_KEY = "zk_unit_test";
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    let body = { data: [] };
    if (u.pathname.endsWith("/chains/")) {
      body = CHAINS_FIXTURE;
    } else {
      const match = u.pathname.match(/\/fungibles\/([^/]+)/);
      if (match) body = FUNGIBLES_FIXTURE[match[1]] ?? { data: null };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  __setCatalogForTests(null);
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ZERION_API_KEY;
  else process.env.ZERION_API_KEY = originalApiKey;
});

describe("resolveToken — ETH on chains whose native coin is not ETH", () => {
  it("does not resolve ETH to the native asset on polygon", async () => {
    const resolved = await resolveToken("ETH", "polygon");
    assert.equal(resolved.fungibleId, "eth");
    assert.equal(resolved.symbol, "ETH");
    assert.notEqual(resolved.address, NATIVE_ASSET_ADDRESS);
  });

  it("resolves the chain's own native symbol to the native asset", async () => {
    const resolved = await resolveToken("POL", "polygon");
    assert.equal(resolved.fungibleId, "polygon-native");
    assert.equal(resolved.address, NATIVE_ASSET_ADDRESS);
  });

  it("still resolves ETH to the native asset where ETH is native", async () => {
    const resolved = await resolveToken("ETH", "base");
    assert.equal(resolved.fungibleId, "eth");
    assert.equal(resolved.address, NATIVE_ASSET_ADDRESS);
  });
});
