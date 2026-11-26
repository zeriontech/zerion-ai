// Safe chain discovery against an injected fetchImpl; bodies mirror safe-config responses observed 2026-10-13.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSafeChainInfo } from "#zerion/utils/safe/chain-info.js";

function respond(status, body) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

describe("getSafeChainInfo", () => {
  it("parses the MegaETH body and strips its trailing slash", async () => {
    const { fetchImpl, requests } = respond(200, {
      chainId: "4326",
      shortName: "megaeth",
      transactionService: "https://api.safe.global/tx-service/mega/",
    });

    const info = await getSafeChainInfo(4326, { fetchImpl });

    assert.deepEqual(info, { txServiceUrl: "https://api.safe.global/tx-service/mega", shortName: "megaeth" });
    assert.deepEqual(requests, ["https://safe-config.safe.global/api/v1/chains/4326/"]);
  });

  it("leaves a URL without a trailing slash unchanged and strips only one slash", async () => {
    const mantle = await getSafeChainInfo(5000, {
      fetchImpl: respond(200, { shortName: "mnt", transactionService: "https://api.safe.global/tx-service/mantle" }).fetchImpl,
    });
    assert.deepEqual(mantle, { txServiceUrl: "https://api.safe.global/tx-service/mantle", shortName: "mnt" });

    const doubled = await getSafeChainInfo(1, {
      fetchImpl: respond(200, { shortName: "eth", transactionService: "https://example.test/tx//" }).fetchImpl,
    });
    assert.equal(doubled.txServiceUrl, "https://example.test/tx/");
  });

  it("maps a missing or empty transactionService to null", async () => {
    const info = await getSafeChainInfo(1, {
      fetchImpl: respond(200, { shortName: "eth", transactionService: "" }).fetchImpl,
    });
    assert.deepEqual(info, { txServiceUrl: null, shortName: "eth" });
  });

  it("maps 404 to both fields null", async () => {
    const info = await getSafeChainInfo(999999, { fetchImpl: respond(404, { detail: "Not found." }).fetchImpl });
    assert.deepEqual(info, { txServiceUrl: null, shortName: null });
  });

  for (const status of [403, 500, 503]) {
    it(`throws safe_chain_info_unavailable on HTTP ${status}`, async () => {
      await assert.rejects(getSafeChainInfo(137, { fetchImpl: respond(status, {}).fetchImpl }), {
        code: "safe_chain_info_unavailable",
      });
    });
  }

  it("throws safe_chain_info_unavailable on a network error", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(getSafeChainInfo(137, { fetchImpl }), { code: "safe_chain_info_unavailable" });
  });
});
