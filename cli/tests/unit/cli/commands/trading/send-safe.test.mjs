// `send` on a Safe skips the EOA nonce read and gas estimate and gates native balance on `amount` alone, while EOA `send`
// keeps its nonce read, gas estimate and decideSigningRoute. RPC goes through a fetch stub that records every JSON-RPC method.

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTypedData, keccak256, parseEther, toHex } from "viem";

// Public Safe from the base golden vector (1.4.1 L2); the recipient is a well-known test account.
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const READONLY_EOA = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RPC_URL = "http://rpc.test/base";
const AMOUNT = "0.01";

let send;
let __setSubmitDepsForTests;
let SAFE_TX_TYPES;
let eoaAddress;
let tmpHome;
let rpc;
let otherRequests;
let safeBalance;
let submitRuns;
const origHome = process.env.HOME;
const origNoBrowser = process.env.ZERION_NO_BROWSER;
const origSafeKey = process.env.SAFE_API_KEY;
const originalFetch = globalThis.fetch;

const CATALOG = new Map([
  ["base", {
    id: "base",
    name: "base",
    externalIdHex: "0x2105",
    chainIdNum: 8453,
    rpcHttpUrls: [RPC_URL],
    nativeFungibleId: null,
    flags: { supportsTrading: true, supportsBridge: true, supportsSending: true },
    caip2: "eip155:8453",
    viemChain: {
      id: 8453,
      name: "base",
      nativeCurrency: { name: "base", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
    },
  }],
]);

function rpcResult(method, params) {
  switch (method) {
    case "eth_chainId":
      return "0x2105";
    case "eth_getTransactionCount":
      return "0x5";
    case "eth_getBlockByNumber":
      return { number: "0x1", hash: `0x${"11".repeat(32)}`, baseFeePerGas: "0x3b9aca00", timestamp: "0x1", transactions: [] };
    case "eth_maxPriorityFeePerGas":
      return "0x1";
    case "eth_estimateGas":
      return "0x5208";
    case "eth_getBalance":
      return params[0].toLowerCase() === SAFE.toLowerCase() ? toHex(safeBalance) : toHex(10n ** 18n);
    default:
      throw new Error(`unexpected RPC ${method}`);
  }
}

function safeClient() {
  return {
    getCode: async () => "0x6080",
    getStorageAt: async () => `0x${"00".repeat(32)}`,
    readContract: async ({ functionName, args }) => {
      switch (functionName) {
        case "VERSION":
          return "1.4.1";
        case "getOwners":
          return [eoaAddress];
        case "getThreshold":
          return 1n;
        case "nonce":
          return 3n;
        case "getModulesPaginated":
          return [[], "0x0000000000000000000000000000000000000001"];
        case "getTransactionHash": {
          const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce] = args;
          return hashTypedData({
            domain: { chainId: 8453, verifyingContract: SAFE },
            types: SAFE_TX_TYPES,
            primaryType: "SafeTx",
            message: { to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce },
          });
        }
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 50_000n,
    getBalance: async () => 10n ** 18n,
    getTransactionCount: async () => 0,
    sendRawTransaction: async ({ serializedTransaction }) => keccak256(serializedTransaction),
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 1n, gasUsed: 1n }),
  };
}

async function run(args, flags) {
  let stdout = "";
  let stderr = "";
  const saved = { out: process.stdout.write, err: process.stderr.write, exit: process.exit };
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
    await send(args, flags);
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    code = err.exitCode;
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    process.exit = saved.exit;
  }
  const errorStart = stderr.indexOf("{\n  \"error\"");
  return {
    code,
    stdout,
    stderr,
    error: errorStart === -1 ? null : JSON.parse(stderr.slice(errorStart, stderr.indexOf("\n}\n", errorStart) + 2)).error,
  };
}

const methods = () => rpc.map((r) => r.method);

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-send-safe-"));
  process.env.HOME = tmpHome;
  process.env.ZERION_NO_BROWSER = "1";
  delete process.env.SAFE_API_KEY;
  send = (await import("#zerion/commands/trading/send.js")).default;
  ({ __setSubmitDepsForTests } = await import("#zerion/utils/safe/submit.js"));
  ({ SAFE_TX_TYPES } = await import("#zerion/utils/safe/safe-tx.js"));
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  const ows = await import("#zerion/utils/wallet/keystore.js");
  eoaAddress = ows.createWallet("eoa").evmAddress;
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  addReadonly("ro-eoa", READONLY_EOA);
  const { addSafe } = await import("#zerion/utils/safe/registry.js");
  addSafe({ name: "solo", address: SAFE, signers: ["eoa"] });
  addSafe({ name: "duo", address: SAFE, signers: ["eoa", "ro-eoa"] });
});

after(async () => {
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(null);
  process.env.HOME = origHome;
  if (origNoBrowser === undefined) delete process.env.ZERION_NO_BROWSER;
  else process.env.ZERION_NO_BROWSER = origNoBrowser;
  if (origSafeKey !== undefined) process.env.SAFE_API_KEY = origSafeKey;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  rpc = [];
  otherRequests = [];
  submitRuns = 0;
  safeBalance = parseEther(AMOUNT);
  globalThis.fetch = async (url, init) => {
    if (String(url) !== RPC_URL) {
      otherRequests.push(String(url));
      throw new Error(`unexpected network call to ${url}`);
    }
    const { id, method, params } = JSON.parse(init.body);
    rpc.push({ method, params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: rpcResult(method, params) }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  __setSubmitDepsForTests({
    resolveChain: async () => {
      submitRuns += 1;
      return { chainIdNum: 8453 };
    },
    getPublicClient: async () => safeClient(),
    getSafeChainInfo: async () => ({ txServiceUrl: null, shortName: "base" }),
    signSafeTxAsOwner: async ({ signer, signMode, route }) => ({
      owner: signer.address,
      signature: `0x${"11".repeat(64)}1b`,
      signMode,
      signedVia: route,
    }),
    requireAgentToken: async () => "agent-token",
    signAndSerialize: async () => `0x02${"22".repeat(40)}`,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __setSubmitDepsForTests(null);
});

describe("send --wallet <safe>", () => {
  it("reads no EOA nonce, estimates no gas, gates native balance on amount only and prints the Safe result", async () => {
    const { code, stdout, stderr } = await run(["ETH", AMOUNT], { wallet: "solo", to: RECIPIENT, chain: "base" });
    assert.equal(code, 0, stderr);

    assert.deepEqual(methods(), ["eth_getBalance"]);
    assert.equal(rpc[0].params[0].toLowerCase(), SAFE.toLowerCase());
    assert.equal(submitRuns, 1);

    const out = JSON.parse(stdout);
    assert.equal(out.send.from, SAFE);
    assert.equal(out.send.type, "native");
    assert.equal(out.safe.status, "executed");
    assert.equal(out.safe.confirmations, "1/1");
    assert.equal(out.safe.safe, SAFE);
  });

  it("refuses a native send the Safe cannot cover, before submitting", async () => {
    safeBalance = parseEther(AMOUNT) - 1n;
    const { code, error, stderr } = await run(["ETH", AMOUNT], { wallet: "solo", to: RECIPIENT, chain: "base" });
    assert.equal(code, 1, stderr);
    assert.equal(error?.code, "insufficient_balance");
    assert.equal(submitRuns, 0);
  });

  for (const wallet of ["solo", "duo"]) {
    it(`refuses --prepare with safe_unsupported_command before any network call (${wallet})`, async () => {
      const { code, error, stdout, stderr } = await run(["ETH", AMOUNT], {
        wallet, to: RECIPIENT, chain: "base", prepare: true,
      });
      assert.equal(code, 1, stderr);
      assert.equal(error?.code, "safe_unsupported_command");
      assert.ok(error.message.includes("`zerion send --prepare`"), error.message);
      assert.deepEqual(rpc, []);
      assert.deepEqual(otherRequests, []);
      assert.equal(stdout, "");
      assert.equal(submitRuns, 0);
    });
  }
});

describe("send on an EOA is unchanged", () => {
  for (const [wallet, route, reason] of [
    ["eoa", "local", "auto-sign"],
    ["ro-eoa", "web-app", "read-only wallet"],
  ]) {
    it(`${wallet}: reads the pending nonce, estimates gas, routes with decideSigningRoute, never submits to a Safe`, async () => {
      const { code, stdout, stderr } = await run(["ETH", AMOUNT], {
        wallet, to: RECIPIENT, chain: "base", prepare: true,
      });
      assert.equal(code, 0, stderr);

      const address = wallet === "eoa" ? eoaAddress : READONLY_EOA;
      const nonceRead = rpc.find((r) => r.method === "eth_getTransactionCount");
      assert.deepEqual(nonceRead?.params.map((p) => p.toLowerCase()), [address.toLowerCase(), "pending"]);
      assert.ok(methods().includes("eth_estimateGas"), methods().join(","));
      assert.match(stderr, new RegExp(`Signing route: ${route} — ${reason}\\.`));
      assert.equal(JSON.parse(stdout).route, route);
      assert.equal(submitRuns, 0);
    });
  }

  it("refuses a recipient with a wrong EIP-55 checksum before any network call", async () => {
    const badChecksum = RECIPIENT.replace("C51812", "c51812");
    assert.notEqual(badChecksum, RECIPIENT);
    const { code, error } = await run(["ETH", AMOUNT], { wallet: "eoa", to: badChecksum, chain: "base" });
    assert.equal(code, 1);
    assert.equal(error?.code, "invalid_address");
    assert.deepEqual(rpc, []);
  });
});
