// `safe info` under a temp HOME. Chain reads go through the real viem client against a JSON-RPC fetch stub, safe-config
// is stubbed in the same fetch, and the chain catalog is a fixture, so no network is touched.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAbi, decodeFunctionData, encodeFunctionResult } from "viem";

// Public Safe from the Safe transaction-service golden vectors (1.4.1 on Base).
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const HOT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const COLD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const GUARD = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const MODULE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const SAFE_CONFIG = "https://safe-config.safe.global/api/v1/chains/";
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

const TEST_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);

let safeInfo;
let tmpHome;
let requests;
let rpcDown;
const origHome = process.env.HOME;
const originalFetch = globalThis.fetch;

function chainConfig(id, chainIdNum) {
  const rpc = [`http://rpc.test/${id}`];
  return {
    id,
    name: id,
    externalIdHex: `0x${chainIdNum.toString(16)}`,
    chainIdNum,
    rpcHttpUrls: rpc,
    nativeFungibleId: null,
    flags: { supportsTrading: true, supportsBridge: false, supportsSending: true },
    caip2: `eip155:${chainIdNum}`,
    viemChain: {
      id: chainIdNum,
      name: id,
      nativeCurrency: { name: id, symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: rpc }, public: { http: rpc } },
    },
  };
}

const CATALOG = new Map([
  ["base", chainConfig("base", 8453)],
  ["ethereum", chainConfig("ethereum", 1)],
]);

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rpcResult(method, params) {
  if (method === "eth_getCode") return "0x6080";
  if (method === "eth_getStorageAt") {
    assert.equal(params[1], GUARD_SLOT);
    return `0x${"0".repeat(24)}${GUARD.slice(2).toLowerCase()}`;
  }
  if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
  const { functionName } = decodeFunctionData({ abi: TEST_ABI, data: params[0].data });
  const results = {
    VERSION: "1.4.1",
    getOwners: [HOT.toLowerCase(), COLD.toLowerCase()],
    getThreshold: 2n,
    nonce: 17n,
    getModulesPaginated: [[MODULE.toLowerCase()], "0x0000000000000000000000000000000000000001"],
  };
  return encodeFunctionResult({ abi: TEST_ABI, functionName, result: results[functionName] });
}

async function stubFetch(url, init) {
  const href = String(url);
  requests.push(href);
  if (href === `${SAFE_CONFIG}8453/`) {
    return json(200, { shortName: "base", transactionService: "https://api.safe.global/tx-service/base/" });
  }
  if (href.startsWith(SAFE_CONFIG)) return json(404, { detail: "Not found." });
  const chain = new URL(href).pathname.slice(1);
  if (rpcDown.has(chain)) return json(500, { error: "upstream failure" });
  const { id, method, params } = JSON.parse(init.body);
  return json(200, { jsonrpc: "2.0", id, result: rpcResult(method, params) });
}

async function run(command, args, flags) {
  let stdout = "";
  let stderr = "";
  const saved = { out: process.stdout.write, err: process.stderr.write, exit: process.exit };
  // The node:test reporter writes binary frames to stdout while a command awaits; only string writes are the command's.
  process.stdout.write = (chunk, ...rest) => {
    if (typeof chunk !== "string") return saved.out.call(process.stdout, chunk, ...rest);
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk, ...rest) => {
    if (typeof chunk !== "string") return saved.err.call(process.stderr, chunk, ...rest);
    stderr += chunk;
    return true;
  };
  process.exit = (code) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: code });
  };
  let code = 0;
  try {
    await command(args, flags);
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    code = err.exitCode;
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    process.exit = saved.exit;
  }
  const errorStart = stderr.indexOf("{");
  return {
    code,
    output: stdout ? JSON.parse(stdout) : null,
    error: errorStart === -1 ? null : JSON.parse(stderr.slice(errorStart)).error,
    stderr,
  };
}

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-info-"));
  process.env.HOME = tmpHome;
  ({ default: safeInfo } = await import("#zerion/commands/safe/info.js"));
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  const { addSafe } = await import("#zerion/utils/safe/registry.js");
  addReadonly("hot", HOT);
  addSafe({ name: "treasury", address: SAFE, signers: ["hot"], chains: { base: {}, ethereum: {} } });
});

after(async () => {
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(null);
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  rpcDown = new Set();
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("safe info", () => {
  it("prints a fresh row for the healthy chain and an error row for the failing one, exiting 0", async () => {
    rpcDown.add("ethereum");

    const { code, output, stderr } = await run(safeInfo, [], { wallet: "treasury" });

    assert.equal(code, 0, stderr);
    assert.equal(output.safe, "treasury");
    assert.deepEqual(output.chains[0], {
      chain: "base",
      chainId: 8453,
      address: SAFE,
      version: "1.4.1",
      owners: [HOT, COLD],
      threshold: 2,
      nonce: 17,
      guard: GUARD,
      modules: [MODULE],
      txService: "https://api.safe.global/tx-service/base",
      appPrefix: "base",
    });
    assert.deepEqual(Object.keys(output.chains[1]), ["chain", "error"]);
    assert.equal(output.chains[1].chain, "ethereum");
    assert.equal(typeof output.chains[1].error.code, "string");
    assert.ok(output.chains[1].error.message);
    assert.ok(requests.some((r) => r === "http://rpc.test/base"));
  });

  it("reads only the --chain asked for", async () => {
    const { code, output } = await run(safeInfo, [], { wallet: "treasury", chain: "base" });

    assert.equal(code, 0);
    assert.deepEqual(output.chains.map((row) => row.chain), ["base"]);
    assert.equal(requests.some((r) => r.includes("rpc.test/ethereum")), false);
  });
});
