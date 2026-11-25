// The Safe-only `send` flags are refused on keystore and read-only wallets before any network request, signature or
// broadcast. Every fetch is recorded, so an RPC read or an eth_sendRawTransaction shows up in `requests`.

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toHex } from "viem";

const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const READONLY_EOA = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SOLANA_RECIPIENT = "So11111111111111111111111111111111111111112";
const RPC_URL = "http://rpc.test/base";
const AMOUNT = "0.01";

const SAFE_ONLY_FLAGS = [
  ["signer", "ro-eoa"],
  ["nonce", "next"],
  ["propose-only", true],
  ["sign-mode", "hash"],
];

let send;
let __setSubmitDepsForTests;
let tmpHome;
let requests;
let stubCalls;
const origHome = process.env.HOME;
const origNoBrowser = process.env.ZERION_NO_BROWSER;
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

function rpcResult(method) {
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
      return toHex(10n ** 18n);
    default:
      throw new Error(`unexpected RPC ${method}`);
  }
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

const counted = (result) => async () => {
  stubCalls += 1;
  return result;
};

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-send-safe-flags-"));
  process.env.HOME = tmpHome;
  process.env.ZERION_NO_BROWSER = "1";
  send = (await import("#zerion/commands/trading/send.js")).default;
  ({ __setSubmitDepsForTests } = await import("#zerion/utils/safe/submit.js"));
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  const ows = await import("#zerion/utils/wallet/keystore.js");
  ows.createWallet("eoa");
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  addReadonly("ro-eoa", READONLY_EOA);
});

after(async () => {
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(null);
  process.env.HOME = origHome;
  if (origNoBrowser === undefined) delete process.env.ZERION_NO_BROWSER;
  else process.env.ZERION_NO_BROWSER = origNoBrowser;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  stubCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    requests.push({ url: String(url), method: body.method });
    if (String(url) !== RPC_URL) throw new Error(`unexpected network call to ${url}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: rpcResult(body.method) }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  __setSubmitDepsForTests({
    resolveChain: counted({ chainIdNum: 8453 }),
    signSafeTxAsOwner: counted({ signature: `0x${"11".repeat(64)}1b` }),
    requireAgentToken: counted("agent-token"),
    signAndSerialize: counted(`0x02${"22".repeat(40)}`),
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __setSubmitDepsForTests(null);
});

describe("send refuses Safe-only flags on a non-Safe wallet", () => {
  for (const wallet of ["eoa", "ro-eoa"]) {
    for (const [flag, value] of SAFE_ONLY_FLAGS) {
      it(`${wallet}: --${flag} exits 1 with safe_only_flag before any network request, signature or broadcast`, async () => {
        const { code, error, stdout, stderr } = await run(["ETH", AMOUNT], {
          wallet, to: RECIPIENT, chain: "base", [flag]: value,
        });
        assert.equal(code, 1, stderr);
        assert.equal(error?.code, "safe_only_flag");
        assert.equal(error.message, `--${flag} applies only to a Safe wallet, and "${wallet}" is not one.`);
        assert.deepEqual(requests, []);
        assert.equal(stubCalls, 0);
        assert.equal(stdout, "");
      });
    }
  }

  it("names every Safe-only flag passed together", async () => {
    const { code, error } = await run(["ETH", AMOUNT], {
      wallet: "eoa", to: RECIPIENT, chain: "base", nonce: "7", "propose-only": true,
    });
    assert.equal(code, 1);
    assert.equal(error?.message, `--nonce, --propose-only apply only to a Safe wallet, and "eoa" is not one.`);
    assert.deepEqual(requests, []);
  });

  it("refuses on a Solana send too", async () => {
    const { code, error } = await run(["SOL", AMOUNT], { wallet: "eoa", to: SOLANA_RECIPIENT, "propose-only": true });
    assert.equal(code, 1);
    assert.equal(error?.code, "safe_only_flag");
    assert.deepEqual(requests, []);
    assert.equal(stubCalls, 0);
  });

  it("positive control: without those flags the same keystore send reaches the RPC stub", async () => {
    const { code, stderr } = await run(["ETH", AMOUNT], { wallet: "eoa", to: RECIPIENT, chain: "base", prepare: true });
    assert.equal(code, 0, stderr);
    assert.ok(requests.some((r) => r.method === "eth_getTransactionCount"), JSON.stringify(requests));
  });
});
