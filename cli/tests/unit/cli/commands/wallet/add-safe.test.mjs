// `wallet add-safe` and the `wallet add` name check, under a temp HOME. Chain reads go through the real viem client
// against a JSON-RPC fetch stub, and the chain catalog is a fixture, so no network is touched.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAbi, decodeFunctionData, encodeFunctionResult } from "viem";

// Public Safes from the Safe transaction-service golden vectors: 1.4.1 on Base, and 1.3.0 on Ethereum.
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const OTHER_SAFE = "0x87cc0d34f6111c8A7A4Bdf758a9a715A3675f941";
const HOT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const COLD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const STRANGER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SAFE_CONFIG = "https://safe-config.safe.global/api/v1/chains/";
const ZERO_WORD = `0x${"0".repeat(64)}`;

const TEST_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);

let walletAddSafe;
let walletAdd;
let registry;
let tmpHome;
let safePath;
let requests;
let onchain;
const origHome = process.env.HOME;
const originalFetch = globalThis.fetch;

function chainConfig(id, chainIdNum, supportsTrading = true) {
  const rpc = chainIdNum ? [`http://rpc.test/${id}`] : [];
  return {
    id,
    name: id,
    externalIdHex: chainIdNum ? `0x${chainIdNum.toString(16)}` : "",
    chainIdNum,
    rpcHttpUrls: rpc,
    nativeFungibleId: null,
    flags: { supportsTrading, supportsBridge: false, supportsSending: supportsTrading },
    caip2: chainIdNum ? `eip155:${chainIdNum}` : null,
    viemChain: chainIdNum
      ? {
          id: chainIdNum,
          name: id,
          nativeCurrency: { name: id, symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: rpc }, public: { http: rpc } },
        }
      : null,
  };
}

const CATALOG = new Map([
  ["arbitrum", chainConfig("arbitrum", 42161)],
  ["base", chainConfig("base", 8453)],
  ["ethereum", chainConfig("ethereum", 1)],
  ["solana", chainConfig("solana", null)],
  ["no-trading", chainConfig("no-trading", 77777, false)],
]);

const SAFE_CONFIG_BODIES = {
  8453: { shortName: "base", transactionService: "https://api.safe.global/tx-service/base/" },
  1: { shortName: "eth", transactionService: "https://api.safe.global/tx-service/eth" },
  42161: { shortName: "arb1", transactionService: "https://api.safe.global/tx-service/arb1" },
};

function deployed(version, owners, threshold = 1) {
  return { code: "0x6080", version, owners, threshold };
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rpcResult(state, method, params) {
  if (method === "eth_getCode") return state.code;
  if (method === "eth_getStorageAt") return ZERO_WORD;
  if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
  const { functionName } = decodeFunctionData({ abi: TEST_ABI, data: params[0].data });
  const results = {
    VERSION: state.version,
    getOwners: state.owners,
    getThreshold: BigInt(state.threshold),
    nonce: 5n,
    getModulesPaginated: [[], "0x0000000000000000000000000000000000000001"],
  };
  return encodeFunctionResult({ abi: TEST_ABI, functionName, result: results[functionName] });
}

async function stubFetch(url, init) {
  const href = String(url);
  requests.push(href);
  if (href.startsWith(SAFE_CONFIG)) {
    const body = SAFE_CONFIG_BODIES[Number(href.slice(SAFE_CONFIG.length).replace(/\/$/, ""))];
    return body ? json(200, body) : json(404, { detail: "Not found." });
  }
  const chain = new URL(href).pathname.slice(1);
  const { id, method, params } = JSON.parse(init.body);
  return json(200, { jsonrpc: "2.0", id, result: rpcResult(onchain[chain] ?? { code: "0x" }, method, params) });
}

async function run(command, args, flags) {
  let stdout = "";
  let stderr = "";
  const saved = { out: process.stdout.write, err: process.stderr.write, exit: process.exit };
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
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
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-add-safe-"));
  process.env.HOME = tmpHome;
  safePath = join(tmpHome, ".zerion", "safe-wallets.json");
  ({ default: walletAddSafe } = await import("#zerion/commands/wallet/add-safe.js"));
  ({ default: walletAdd } = await import("#zerion/commands/wallet/add.js"));
  registry = await import("#zerion/utils/safe/registry.js");
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  const ows = await import("#zerion/utils/wallet/keystore.js");
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  addReadonly("hot", HOT);
  addReadonly("cold", COLD);
  addReadonly("sol-ro", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  ows.createWallet("ks-wallet");
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  onchain = {};
  rmSync(safePath, { force: true });
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("wallet add-safe", () => {
  it("probes every EVM trading chain, saves the deployed 1.4.1 chain and skips no-code and 1.1.1 chains", async () => {
    onchain = {
      base: deployed("1.4.1", [HOT.toLowerCase(), COLD.toLowerCase()], 2),
      ethereum: { code: "0x" },
      arbitrum: deployed("1.1.1", [HOT]),
    };

    const { code, output, stderr } = await run(walletAddSafe, [SAFE.toLowerCase()], { name: "treasury", signer: "hot,cold" });

    assert.equal(code, 0, stderr);
    assert.deepEqual(Object.keys(output.safe.chains), ["base"]);
    const { refreshedAt, ...cache } = output.safe.chains.base;
    assert.deepEqual(cache, {
      chainId: 8453,
      version: "1.4.1",
      threshold: 2,
      owners: [HOT, COLD],
      txService: "https://api.safe.global/tx-service/base",
      appPrefix: "base",
    });
    assert.match(refreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(output.skipped, [
      { chain: "arbitrum", reason: "version_unsupported:1.1.1" },
      { chain: "ethereum", reason: "no_code" },
    ]);
    assert.equal(output.safe.address, SAFE);
    assert.deepEqual(output.safe.signers, ["hot", "cold"]);
    assert.equal(output.safe.executor, null);
    assert.deepEqual(registry.getSafe("treasury"), output.safe);

    const probedHosts = new Set(requests.filter((r) => r.startsWith("http://rpc.test/")).map((r) => r.slice(16)));
    assert.deepEqual([...probedHosts].sort(), ["arbitrum", "base", "ethereum"]);
    assert.deepEqual(requests.filter((r) => r.startsWith(SAFE_CONFIG)), [`${SAFE_CONFIG}8453/`]);
  });

  it("probes only the --chains list and records the executor", async () => {
    onchain = { base: deployed("1.3.0", [HOT]), ethereum: deployed("1.3.0", [HOT]) };

    const { code, output } = await run(walletAddSafe, [SAFE], {
      name: "treasury",
      signer: "hot",
      executor: "ks-wallet",
      chains: "base",
    });

    assert.equal(code, 0);
    assert.deepEqual(Object.keys(output.safe.chains), ["base"]);
    assert.equal(output.safe.executor, "ks-wallet");
    assert.equal(requests.some((r) => r.includes("rpc.test/ethereum")), false);
  });

  it("refuses with safe_signer_not_owner, saves nothing and warns per chain when no signer owns the Safe", async () => {
    onchain = { base: deployed("1.4.1", [STRANGER]), ethereum: deployed("1.5.0", [STRANGER]) };

    const { code, error, stderr } = await run(walletAddSafe, [SAFE], { name: "treasury", signer: "hot", chains: "base,ethereum" });

    assert.equal(code, 1);
    assert.equal(error.code, "safe_signer_not_owner");
    assert.equal(existsSync(safePath), false);
    assert.equal(registry.getSafe("treasury"), null);
    assert.match(stderr, /signer "hot" \(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\) is not an owner of the Safe on base/);
    assert.match(stderr, /signer "hot" .* is not an owner of the Safe on ethereum/);
  });

  it("saves when at least one signer owns the Safe, warning for the signer that does not", async () => {
    onchain = { base: deployed("1.4.1", [HOT]) };

    const { code, stderr } = await run(walletAddSafe, [SAFE], { name: "treasury", signer: "hot,cold", chains: "base" });

    assert.equal(code, 0);
    assert.match(stderr, /signer "cold" .* is not an owner of the Safe on base/);
    assert.deepEqual(registry.getSafe("treasury").signers, ["hot", "cold"]);
  });

  const collisions = [
    ["a keystore wallet", "ks-wallet"],
    ["a read-only wallet", "hot"],
    ["a different Safe", "other-safe"],
  ];
  for (const [source, name] of collisions) {
    it(`refuses a name used by ${source} with name_in_use, before any chain read`, async () => {
      registry.addSafe({ name: "other-safe", address: OTHER_SAFE, signers: ["hot"] });
      onchain = { base: deployed("1.4.1", [HOT]) };

      const { code, error } = await run(walletAddSafe, [SAFE], { name, signer: "hot", chains: "base" });

      assert.equal(code, 1);
      assert.equal(error.code, "name_in_use");
      assert.deepEqual(requests, []);
      assert.deepEqual(registry.listSafes().map((s) => [s.name, s.address]), [["other-safe", OTHER_SAFE]]);
    });
  }

  it("updates the entry when the same Safe is re-added under its name", async () => {
    onchain = { base: deployed("1.4.1", [HOT, COLD]) };
    await run(walletAddSafe, [SAFE], { name: "treasury", signer: "hot", chains: "base" });
    const first = registry.getSafe("treasury");

    const { code, output } = await run(walletAddSafe, [SAFE.toLowerCase()], { name: "treasury", signer: "cold", chains: "base" });

    assert.equal(code, 0);
    assert.deepEqual(output.safe.signers, ["cold"]);
    assert.equal(output.safe.createdAt, first.createdAt);
    assert.ok(output.safe.updatedAt);
    assert.equal(registry.listSafes().length, 1);
  });

  for (const [label, flags] of [
    ["an unknown signer", { signer: "hot,ghost" }],
    ["a Solana read-only signer", { signer: "sol-ro" }],
    ["an unknown executor", { signer: "hot", executor: "ghost" }],
  ]) {
    it(`refuses ${label} with wallet_not_found, before any chain read`, async () => {
      const { code, error } = await run(walletAddSafe, [SAFE], { name: "treasury", chains: "base", ...flags });

      assert.equal(code, 1);
      assert.equal(error.code, "wallet_not_found");
      assert.deepEqual(requests, []);
    });
  }
});

describe("wallet add name check", () => {
  for (const [source, name] of [["a keystore wallet", "ks-wallet"], ["a Safe", "other-safe"]]) {
    it(`refuses a name used by ${source} with name_in_use`, async () => {
      registry.addSafe({ name: "other-safe", address: OTHER_SAFE, signers: ["hot"] });

      const { code, error } = await run(walletAdd, [STRANGER], { name });

      assert.equal(code, 1);
      assert.equal(error.code, "name_in_use");
    });
  }

  it("still updates an existing read-only wallet re-added under its name", async () => {
    const { code, output } = await run(walletAdd, [STRANGER], { name: "cold" });

    assert.equal(code, 0);
    assert.deepEqual(output.wallet, { name: "cold", address: STRANGER, type: "read-only", updated: true });
    const restored = await run(walletAdd, [COLD], { name: "cold" });
    assert.equal(restored.output.wallet.address, COLD);
  });
});
