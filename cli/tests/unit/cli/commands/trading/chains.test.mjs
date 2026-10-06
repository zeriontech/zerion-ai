// `zerion chains` calls the Zerion API for the live chain catalog. Stub fetch
// here so the unit suite covers normalization without touching the network.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import chains, { evmChainId, publicRpcUrls } from "#zerion/commands/trading/chains.js";

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
        external_id: "0x1",
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
        external_id: "0x2105",
        rpc: {
          public_servers_url: ["https://mainnet.base.org/", "wss://base-rpc.publicnode.com", "https://base-rpc.publicnode.com"],
        },
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
    {
      id: "solana",
      attributes: {
        name: "Solana",
        external_id: "0x65",
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

    assert.deepEqual(json.chains.map((chain) => chain.id), ["arbitrum", "base", "ethereum", "solana"]);
    assert.equal(json.count, 4);
    assert.deepEqual(json.chains[0], {
      id: "arbitrum",
      name: "Arbitrum",
      chainId: null,
      chainIdHex: null,
      supportsTrading: false,
      supportsBridge: false,
      supportsSending: false,
      rpcUrls: [],
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, "/v1/chains/");
  });

  it("ignores optional extra args from single-word routing fallback", async () => {
    const json = await captureJSON(() => chains(["list"], { json: true }));

    assert.ok(Array.isArray(json.chains));
    assert.equal(json.count, 4);
  });

  // Agents need the numeric id for ABI lookups and the hex id for a hand-built
  // envelope's `chainId`; the catalog's external_id carries it.
  it("adds the EVM chain id as decimal and hex", async () => {
    const json = await captureJSON(() => chains([], {}));
    const base = json.chains.find((c) => c.id === "base");
    assert.equal(base.chainId, 8453);
    assert.equal(base.chainIdHex, "0x2105");
    assert.equal(json.chains.find((c) => c.id === "ethereum").chainId, 1);
  });

  it("gives Solana no EVM chain id", async () => {
    const json = await captureJSON(() => chains([], {}));
    const solana = json.chains.find((c) => c.id === "solana");
    assert.equal(solana.chainId, null);
    assert.equal(solana.chainIdHex, null);
  });
});

// Agents fall back to these when $ETH_RPC_URL isn't set, trying each in turn.
describe("public RPC URLs", () => {
  it("lists the catalog's HTTPS endpoints in order, without WebSocket ones", async () => {
    const json = await captureJSON(() => chains([], {}));
    assert.deepEqual(json.chains.find((c) => c.id === "base").rpcUrls, [
      "https://mainnet.base.org/",
      "https://base-rpc.publicnode.com",
    ]);
  });

  it("returns an empty list when the catalog has none", () => {
    assert.deepEqual(publicRpcUrls(undefined), []);
    assert.deepEqual(publicRpcUrls({}), []);
    assert.deepEqual(publicRpcUrls({ public_servers_url: ["wss://only.ws", 42] }), []);
  });
});

describe("evmChainId", () => {
  it("parses hex external ids and rejects anything else", () => {
    assert.deepEqual(evmChainId("blast", "0x13E31"), { chainId: 81457, chainIdHex: "0x13e31" });
    assert.deepEqual(evmChainId("x", undefined), { chainId: null, chainIdHex: null });
    assert.deepEqual(evmChainId("x", "8453"), { chainId: null, chainIdHex: null });
    assert.deepEqual(evmChainId("solana", "0x65"), { chainId: null, chainIdHex: null });
  });
});
