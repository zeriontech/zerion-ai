// `zerion chains` calls the Zerion API for the live chain catalog. Stub fetch
// here so the unit suite covers normalization without touching the network.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import chains from "#zerion/commands/trading/chains.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ZERION_API_KEY;
const originalStdoutWrite = process.stdout.write;

let requests;

const chainsFixture = {
  data: [
    {
      id: "ethereum",
      attributes: {
        name: "Ethereum",
        flags: {
          supports_trading: true,
          supports_bridge: true,
          supports_sending: true,
        },
      },
    },
    {
      id: "base",
      attributes: {
        name: "Base",
        flags: {
          supports_trading: true,
          supports_bridge: false,
          supports_sending: true,
        },
      },
    },
    {
      id: "arbitrum",
      attributes: {
        name: "Arbitrum",
      },
    },
  ],
};

beforeEach(() => {
  requests = [];
  process.env.ZERION_API_KEY = "zk_unit_test";
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(String(url)), options });
    return new Response(JSON.stringify(chainsFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  if (originalApiKey === undefined) delete process.env.ZERION_API_KEY;
  else process.env.ZERION_API_KEY = originalApiKey;
});

async function captureJSON(fn) {
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };

  await fn();
  return JSON.parse(stdout);
}

describe("chains — API-backed catalog", () => {
  it("returns normalized chains sorted by name", async () => {
    const json = await captureJSON(() => chains([], {}));

    assert.deepEqual(json.chains.map((chain) => chain.id), ["arbitrum", "base", "ethereum"]);
    assert.equal(json.count, 3);
    assert.deepEqual(json.chains[0], {
      id: "arbitrum",
      name: "Arbitrum",
      supportsTrading: false,
      supportsBridge: false,
      supportsSending: false,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, "/v1/chains/");
  });

  it("ignores optional extra args from single-word routing fallback", async () => {
    const json = await captureJSON(() => chains(["list"], { json: true }));

    assert.ok(Array.isArray(json.chains));
    assert.equal(json.count, 3);
  });
});
