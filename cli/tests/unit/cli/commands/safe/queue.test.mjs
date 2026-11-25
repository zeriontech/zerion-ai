// `safe queue` under a temp HOME: chain reads, safe-config and the Safe Transaction Service are one fetch stub, local
// receipts are files under the temp HOME, and the chain catalog is a fixture, so no network is touched.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAbi, decodeFunctionData, encodeFunctionData, encodeFunctionResult, erc20Abi } from "viem";

// Public Safe from the Safe transaction-service golden vectors (1.4.1 on Base).
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const HOT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const COLD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TOKEN = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SAFE_CONFIG = "https://safe-config.safe.global/api/v1/chains/";
const TX_SERVICE = "https://api.safe.global/tx-service/base";
const ONCHAIN_NONCE = 5;
const ZERO_WORD = `0x${"0".repeat(64)}`;
const SIG = `0x${"11".repeat(65)}`;

const TEST_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);

let safeQueue;
let safeInfo;
let decodeCall;
let safeTx;
let tmpHome;
let requests;
let queued;
const origHome = process.env.HOME;
const origApiKey = process.env.SAFE_API_KEY;
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
  ["no-service", chainConfig("no-service", 77777)],
]);

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rpcResult(method, params) {
  if (method === "eth_getCode") return "0x6080";
  if (method === "eth_getStorageAt") return ZERO_WORD;
  if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
  const { functionName } = decodeFunctionData({ abi: TEST_ABI, data: params[0].data });
  const results = {
    VERSION: "1.4.1",
    getOwners: [HOT, COLD],
    getThreshold: 2n,
    nonce: BigInt(ONCHAIN_NONCE),
    getModulesPaginated: [[], "0x0000000000000000000000000000000000000001"],
  };
  return encodeFunctionResult({ abi: TEST_ABI, functionName, result: results[functionName] });
}

async function stubFetch(url, init = {}) {
  const href = String(url);
  requests.push(href);
  if (href === `${SAFE_CONFIG}8453/`) {
    return json(200, { shortName: "base", transactionService: `${TX_SERVICE}/` });
  }
  if (href.startsWith(SAFE_CONFIG)) return json(404, { detail: "Not found." });
  if (href.startsWith(`${TX_SERVICE}/`)) return json(200, { count: queued.length, results: queued });
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

function typedData(chainId, { to, value = "0", data = "0x", nonce }) {
  return safeTx.toSafeTypedData({ chainId, safeAddress: SAFE, message: safeTx.buildSafeTxMessage({ to, value, data, nonce }) });
}

function receiptDir(chainId) {
  return join(tmpHome, ".zerion", "safe-pending", SAFE, String(chainId));
}

function writeReceipt(chainId, tx, { signers = [HOT], status = "proposed" } = {}) {
  const td = typedData(chainId, tx);
  const hash = safeTx.hashSafeTx(td);
  const signatures = Object.fromEntries(signers.map((owner) => [owner, SIG]));
  mkdirSync(receiptDir(chainId), { recursive: true });
  writeFileSync(join(receiptDir(chainId), `${hash}.json`), JSON.stringify({ safeTx: td, signatures, origin: "zerion-cli", status }));
  return hash;
}

function serviceTx(safeTxHash, { to, value = "0", data = null, nonce }, confirmations) {
  return {
    safeTxHash,
    nonce: String(nonce),
    to,
    value,
    data,
    operation: 0,
    confirmations: Array.from({ length: confirmations }, () => ({ owner: HOT })),
    confirmationsRequired: 2,
  };
}

const hashOf = (n) => `0x${n.toString(16).padStart(64, "0")}`;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-queue-"));
  process.env.HOME = tmpHome;
  ({ default: safeQueue, decodeCall } = await import("#zerion/commands/safe/queue.js"));
  ({ default: safeInfo } = await import("#zerion/commands/safe/info.js"));
  safeTx = await import("#zerion/utils/safe/safe-tx.js");
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  const { addSafe } = await import("#zerion/utils/safe/registry.js");
  const ows = await import("#zerion/utils/wallet/keystore.js");
  addReadonly("hot", HOT);
  ows.createWallet("ks-wallet");
  addSafe({ name: "treasury", address: SAFE, signers: ["hot"], chains: { base: {} } });
});

after(async () => {
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(null);
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  queued = [];
  process.env.SAFE_API_KEY = "test-key";
  rmSync(join(tmpHome, ".zerion", "safe-pending"), { recursive: true, force: true });
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (origApiKey === undefined) delete process.env.SAFE_API_KEY;
  else process.env.SAFE_API_KEY = origApiKey;
});

describe("safe queue", () => {
  it("marks stale and conflicting nonces, merges shared hashes into one row and skips an unparseable receipt", async () => {
    const shared = { to: COLD, value: "1000", nonce: 5 };
    const sharedHash = writeReceipt(8453, shared, { signers: [HOT, COLD] });
    const localOnlyHash = writeReceipt(8453, { to: COLD, value: "7", nonce: 7 });
    const localStaleHash = writeReceipt(8453, { to: COLD, value: "3", nonce: 3 });
    writeReceipt(8453, { to: COLD, value: "4", nonce: 4 }, { status: "executed" });
    writeFileSync(join(receiptDir(8453), "garbage.json"), "{not json");
    queued = [
      serviceTx(hashOf(4), { to: COLD, value: "4", nonce: 4 }, 2),
      serviceTx(sharedHash, shared, 1),
      serviceTx(hashOf(6), { to: COLD, value: "6", nonce: 6 }, 1),
      serviceTx(hashOf(0x66), { to: HOT, value: "6", nonce: 6 }, 0),
    ];

    const { code, output, stderr } = await run(safeQueue, [], { wallet: "treasury" });

    assert.equal(code, 0, stderr);
    assert.match(stderr, /Warning: skipping unreadable Safe receipt .*garbage\.json/);
    const [row] = output.chains;
    assert.equal(row.chain, "base");
    assert.equal(row.nonce, ONCHAIN_NONCE);
    assert.equal(row.txService, TX_SERVICE);
    assert.equal(row.error, undefined);

    const summary = row.queue.map((e) => [e.safeTxHash, e.nonce, e.source, e.confirmations, e.stale, e.conflict]);
    assert.deepEqual(summary, [
      [localStaleHash, 3, "local", "1/2", true, false],
      [hashOf(4), 4, "tx-service", "2/2", true, false],
      [sharedHash, 5, "both", "2/2", false, false],
      [hashOf(6), 6, "tx-service", "1/2", false, true],
      [hashOf(0x66), 6, "tx-service", "0/2", false, true],
      [localOnlyHash, 7, "local", "1/2", false, false],
    ]);
    for (const entry of row.queue) {
      assert.equal(entry.stale, entry.nonce < ONCHAIN_NONCE, entry.safeTxHash);
      assert.equal(entry.conflict, row.queue.filter((other) => other.nonce === entry.nonce).length > 1, entry.safeTxHash);
    }
    assert.deepEqual(row.queue[2].call, { kind: "native", to: COLD, value: "1000" });

    const serviceCalls = requests.filter((r) => r.startsWith(TX_SERVICE));
    assert.equal(serviceCalls.length, 1);
    assert.match(serviceCalls[0], new RegExp(`/api/v1/safes/${SAFE}/multisig-transactions/\\?executed=false&nonce__gte=0&`));
  });

  it("keeps local receipts and reports safe_api_key_missing when the chain has a service but no key is set", async () => {
    delete process.env.SAFE_API_KEY;
    const localHash = writeReceipt(8453, { to: COLD, value: "1", nonce: 6 });

    const { code, output } = await run(safeQueue, [], { wallet: "treasury" });

    assert.equal(code, 0);
    const [row] = output.chains;
    assert.equal(row.error.code, "safe_api_key_missing");
    assert.equal(row.txService, TX_SERVICE);
    assert.deepEqual(row.queue.map((e) => [e.safeTxHash, e.source]), [[localHash, "local"]]);
    assert.equal(requests.some((r) => r.startsWith(TX_SERVICE)), false);
  });

  it("lists local receipts with txService null on a chain without a service", async () => {
    const localHash = writeReceipt(77777, { to: COLD, value: "1", nonce: 5 });

    const { code, output } = await run(safeQueue, [], { wallet: "treasury", chain: "no-service" });

    assert.equal(code, 0);
    const [row] = output.chains;
    assert.equal(row.txService, null);
    assert.equal(row.error, undefined);
    assert.deepEqual(row.queue.map((e) => [e.safeTxHash, e.source, e.confirmations]), [[localHash, "local", "1/2"]]);
  });
});

describe("safe queue call decoder", () => {
  const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [COLD, 2_500_000n] });
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [COLD, 2_500_000n] });
  const cases = [
    ["native transfer with 0x data", { to: COLD, value: "1000000000000000000", data: "0x", operation: 0 },
      { kind: "native", to: COLD, value: "1000000000000000000" }],
    ["native transfer with null data", { to: COLD, value: "5", data: null, operation: 0 },
      { kind: "native", to: COLD, value: "5" }],
    ["ERC-20 transfer", { to: TOKEN, value: "0", data: transfer, operation: 0 },
      { kind: "erc20-transfer", token: TOKEN, to: COLD, amount: "2500000" }],
    ["ERC-20 approve", { to: TOKEN, value: "0", data: approve, operation: 0 },
      { kind: "raw", to: TOKEN, value: "0", data: approve }],
    ["calldata shorter than 4 bytes", { to: TOKEN, value: "0", data: "0xa9059c", operation: 0 },
      { kind: "raw", to: TOKEN, value: "0", data: "0xa9059c" }],
    ["transfer calldata that also sends value", { to: TOKEN, value: "1", data: transfer, operation: 0 },
      { kind: "raw", to: TOKEN, value: "1", data: transfer }],
    ["transfer calldata with trailing bytes", { to: TOKEN, value: "0", data: `${transfer}00`, operation: 0 },
      { kind: "raw", to: TOKEN, value: "0", data: `${transfer}00` }],
    ["transfer calldata as a delegatecall", { to: TOKEN, value: "0", data: transfer, operation: 1 },
      { kind: "raw", to: TOKEN, value: "0", data: transfer }],
    ["empty-data delegatecall", { to: COLD, value: "5", data: "0x", operation: 1 },
      { kind: "raw", to: COLD, value: "5", data: "0x" }],
  ];
  for (const [label, call, expected] of cases) {
    it(`labels ${label} as ${expected.kind}`, () => {
      assert.deepEqual(decodeCall(call), expected);
    });
  }
});

describe("safe commands refuse a non-Safe wallet", () => {
  for (const [name, wallet] of [["read-only", "hot"], ["keystore", "ks-wallet"]]) {
    for (const [command, handler] of [["info", () => safeInfo], ["queue", () => safeQueue]]) {
      it(`safe ${command} exits 1 with not_a_safe for a ${name} wallet, before any network call`, async () => {
        const { code, error, output } = await run(handler(), [], { wallet });

        assert.equal(code, 1);
        assert.equal(error.code, "not_a_safe");
        assert.equal(output, null);
        assert.deepEqual(requests, []);
      });
    }
  }
});
