// Every signing command other than `send` refuses a Safe wallet with safe_unsupported_command, before any quote,
// RPC call, link or signature. The chain catalog is a fixture, fetch throws on any URL, and no browser may open.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Public Safes from the Safe transaction-service golden vectors: 1.4.1 on Base, and 1.3.0 on Ethereum.
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const OTHER_SAFE = "0x87cc0d34f6111c8A7A4Bdf758a9a715A3675f941";
const HOT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const COLD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const TYPED_DATA = JSON.stringify({
  domain: { name: "Test", version: "1", chainId: 8453 },
  types: { Mail: [{ name: "contents", type: "string" }] },
  primaryType: "Mail",
  message: { contents: "hello" },
});

let commands;
let tmpHome;
let requests;
const origHome = process.env.HOME;
const origNoBrowser = process.env.ZERION_NO_BROWSER;
const originalFetch = globalThis.fetch;

function chainConfig(id, chainIdNum) {
  const rpc = chainIdNum ? [`http://rpc.test/${id}`] : [];
  return {
    id,
    name: id,
    externalIdHex: chainIdNum ? `0x${chainIdNum.toString(16)}` : "",
    chainIdNum,
    rpcHttpUrls: rpc,
    nativeFungibleId: null,
    flags: { supportsTrading: true, supportsBridge: true, supportsSending: true },
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
  ["solana", chainConfig("solana", null)],
]);

function bundleGroup(walletName, address) {
  return JSON.stringify({
    kind: "zerion-prepared-group",
    version: 1,
    ecosystem: "evm",
    chain: "base",
    address,
    walletName,
    route: "web-app",
    summary: {},
    outflows: [],
    transactions: [{ label: "Protocol call", evm: {
      type: "0x2", from: address, to: "0x00000000000000000000000000000000000000c3",
      chainId: "0x2105", gas: "0x5208", value: "0x0", data: "0x",
    } }],
  });
}

const SAFES = { solo: SAFE, duo: OTHER_SAFE };

const INVOCATIONS = {
  swap: (wallet, chain = "base") => [[chain, "1", "USDC", "ETH"], { wallet }],
  bridge: (wallet, chain = "base") => [[chain, "USDC", "1", "arbitrum", "USDC"], { wallet }],
  consolidate: (wallet, chain = "base") => [[chain, "USDC"], { wallet }],
  "sign-message": (wallet, chain = "base") => [["hello"], { wallet, chain }],
  "sign-typed-data": (wallet) => [[], { wallet, chain: "base", data: TYPED_DATA }],
  bundle: (wallet) => [[], { group: bundleGroup(wallet, SAFES[wallet]) }],
};

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
    stdout,
    stderr,
    error: errorStart === -1 ? null : JSON.parse(stderr.slice(errorStart)).error,
  };
}

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-refusals-"));
  process.env.HOME = tmpHome;
  process.env.ZERION_NO_BROWSER = "1";
  commands = {
    swap: (await import("#zerion/commands/trading/swap.js")).default,
    bridge: (await import("#zerion/commands/trading/bridge.js")).default,
    consolidate: (await import("#zerion/commands/trading/consolidate.js")).default,
    "sign-message": (await import("#zerion/commands/wallet/sign-message.js")).default,
    "sign-typed-data": (await import("#zerion/commands/wallet/sign-typed-data.js")).default,
    bundle: (await import("#zerion/commands/trading/bundle.js")).default,
  };
  const { __setCatalogForTests } = await import("#zerion/utils/chain/catalog.js");
  __setCatalogForTests(CATALOG);
  const { addReadonly } = await import("#zerion/utils/wallet/readonly.js");
  const { addSafe } = await import("#zerion/utils/safe/registry.js");
  addReadonly("hot", HOT);
  addReadonly("cold", COLD);
  addSafe({ name: "solo", address: SAFE, signers: ["hot"] });
  addSafe({ name: "duo", address: OTHER_SAFE, signers: ["hot", "cold"] });
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
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error(`unexpected network call to ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function assertRefused(name, [args, flags]) {
  const { code, error, stdout, stderr } = await run(commands[name], args, flags);
  assert.equal(code, 1, stderr);
  assert.equal(error?.code, "safe_unsupported_command", stderr);
  assert.deepEqual(requests, []);
  assert.equal(stdout, "");
  assert.doesNotMatch(stderr, /\/cli\/(transaction|message)|Signing route/);
}

describe("signing commands refuse a Safe wallet", () => {
  for (const name of Object.keys(INVOCATIONS)) {
    it(`${name} refuses a one-signer Safe`, () => assertRefused(name, INVOCATIONS[name]("solo")));

    it(`${name} refuses a two-signer Safe without --signer, not with safe_signer_required`, () =>
      assertRefused(name, INVOCATIONS[name]("duo")));
  }

  // consolidate validates the chain before the wallet, and sign-typed-data refuses Solana as evm_only, for every wallet.
  for (const name of ["swap", "bridge", "sign-message"]) {
    it(`${name} refuses a Safe on Solana, not with safe_chain_mismatch`, () =>
      assertRefused(name, INVOCATIONS[name]("solo", "solana")));
  }
});
