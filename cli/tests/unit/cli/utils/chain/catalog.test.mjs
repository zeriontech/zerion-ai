import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { __buildCatalogForTests } from "#zerion/utils/chain/catalog.js";

// Minimal /v1/chains/ payload shaped like the real response.
function chainsResponse(...items) {
  return { data: items };
}

function chainItem(id, publicServersUrl, externalId = "0x1") {
  return {
    id,
    attributes: {
      name: id,
      external_id: externalId,
      rpc: { public_servers_url: publicServersUrl },
      flags: { supports_trading: true, supports_sending: true, supports_bridge: true },
    },
  };
}

const catalogFrom = (response) => __buildCatalogForTests(response);

describe("chain catalog RPC resolution", () => {
  afterEach(() => {
    delete process.env.ZERION_RPC_URL_ARC;
    delete process.env.ZERION_RPC_URL_BINANCE_SMART_CHAIN;
  });

  test("keeps the catalog's own URLs in order", () => {
    const catalog = catalogFrom(
      chainsResponse(chainItem("base", ["https://a.example", "https://b.example"]))
    );
    assert.deepEqual(catalog.get("base").rpcHttpUrls, [
      "https://a.example",
      "https://b.example",
    ]);
  });

  test("drops non-http entries such as websocket URLs", () => {
    const catalog = catalogFrom(
      chainsResponse(chainItem("redstone", ["wss://a.example", "https://b.example"]))
    );
    assert.deepEqual(catalog.get("redstone").rpcHttpUrls, ["https://b.example"]);
  });

  test("appends seeded fallbacks after the catalog's own URLs", () => {
    const catalog = catalogFrom(
      chainsResponse(chainItem("arc", ["https://rpc.zerion.io/v1/arc"], "0x13b2"))
    );
    const urls = catalog.get("arc").rpcHttpUrls;
    // Catalog entry still wins; the seed only gets used once it errors.
    assert.equal(urls[0], "https://rpc.zerion.io/v1/arc");
    assert.ok(urls.includes("https://rpc.mainnet.arc.io"));
    assert.ok(urls.length > 1, "arc must have a reachable fallback");
  });

  test("ZERION_RPC_URL_<CHAIN> takes precedence over everything", () => {
    process.env.ZERION_RPC_URL_ARC = "https://my-node.example";
    const catalog = catalogFrom(
      chainsResponse(chainItem("arc", ["https://rpc.zerion.io/v1/arc"], "0x13b2"))
    );
    assert.equal(catalog.get("arc").rpcHttpUrls[0], "https://my-node.example");
  });

  test("override env var maps dashes to underscores", () => {
    process.env.ZERION_RPC_URL_BINANCE_SMART_CHAIN = "https://bsc.example";
    const catalog = catalogFrom(
      chainsResponse(chainItem("binance-smart-chain", ["https://a.example"], "0x38"))
    );
    assert.equal(catalog.get("binance-smart-chain").rpcHttpUrls[0], "https://bsc.example");
  });

  test("ignores a malformed override instead of poisoning the list", () => {
    process.env.ZERION_RPC_URL_ARC = "not-a-url";
    const catalog = catalogFrom(
      chainsResponse(chainItem("arc", ["https://rpc.zerion.io/v1/arc"], "0x13b2"))
    );
    assert.equal(catalog.get("arc").rpcHttpUrls[0], "https://rpc.zerion.io/v1/arc");
  });

  test("de-duplicates when the override repeats a catalog URL", () => {
    process.env.ZERION_RPC_URL_ARC = "https://rpc.mainnet.arc.io";
    const catalog = catalogFrom(
      chainsResponse(chainItem("arc", ["https://rpc.zerion.io/v1/arc"], "0x13b2"))
    );
    const urls = catalog.get("arc").rpcHttpUrls;
    const seen = new Set(urls);
    assert.equal(seen.size, urls.length);
  });

  test("skips items with no id", () => {
    const catalog = catalogFrom(chainsResponse(chainItem("base", ["https://a.example"]), { id: "" }));
    assert.equal(catalog.size, 1);
  });
});
