// Opt-in suite (`npm run test:fork`, never `npm test`): a 1-of-1 Safe send on a local anvil fork of base (FORK_RPC_URL).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const FORK_RPC_URL = process.env.FORK_RPC_URL || "https://base-rpc.publicnode.com";
const BASE_CHAIN_ID = 8453;
const ANVIL_START_TIMEOUT_MS = 60_000;

const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_L2_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";

const OWNER_KEY = keccak256(toHex("zerion-safe-test-owner-1"));
const OWNER = privateKeyToAccount(OWNER_KEY);
const RECIPIENT = privateKeyToAccount(keccak256(toHex("zerion-safe-test-recipient"))).address;
const OWNER_WALLET = "fork-owner";
const PASSPHRASE = "fork-test-passphrase";
const SAFE_FUNDING = parseEther("1");
const OWNER_FUNDING = parseEther("1");
const AMOUNT = parseEther("0.25");

const FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);
const SETUP_ABI = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);

const anvilMissing = spawnSync("anvil", ["--version"]).error
  ? "anvil is not on PATH: install Foundry (https://getfoundry.sh) to run the Safe fork suite"
  : false;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startAnvil(port) {
  const child = spawn("anvil", ["--fork-url", FORK_RPC_URL, "--host", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`anvil did not start within ${ANVIL_START_TIMEOUT_MS} ms:\n${output}`));
    }, ANVIL_START_TIMEOUT_MS);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes("Listening on")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`anvil exited with code ${code} before listening:\n${output}`));
    });
  });
}

function baseCatalogEntry(rpcUrl) {
  return {
    id: "base",
    name: "Base",
    externalIdHex: `0x${BASE_CHAIN_ID.toString(16)}`,
    chainIdNum: BASE_CHAIN_ID,
    rpcHttpUrls: [rpcUrl],
    nativeFungibleId: null,
    flags: { supportsTrading: true, supportsBridge: true, supportsSending: true },
    caip2: `eip155:${BASE_CHAIN_ID}`,
    viemChain: {
      id: BASE_CHAIN_ID,
      name: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    },
  };
}

describe("Safe send on an anvil fork of base", { skip: anvilMissing }, () => {
  const origHome = process.env.HOME;
  const origEnvToken = process.env.ZERION_AGENT_TOKEN;
  let anvil;
  let tmpHome;
  let publicClient;
  let submit;
  let catalog;
  let safeAddress;

  before(async () => {
    const port = await freePort();
    anvil = await startAnvil(port);
    const rpcUrl = `http://127.0.0.1:${port}`;
    const chain = baseCatalogEntry(rpcUrl).viemChain;
    publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
    const ownerClient = createWalletClient({ account: OWNER, chain, transport: http(rpcUrl) });

    await testClient.setBalance({ address: OWNER.address, value: OWNER_FUNDING });
    const initializer = encodeFunctionData({
      abi: SETUP_ABI,
      functionName: "setup",
      args: [[OWNER.address], 1n, zeroAddress, "0x", FALLBACK_HANDLER, zeroAddress, 0n, zeroAddress],
    });
    const { result, request } = await publicClient.simulateContract({
      account: OWNER,
      address: SAFE_PROXY_FACTORY,
      abi: FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args: [SAFE_L2_SINGLETON, initializer, BigInt(Date.now())],
    });
    const deployed = await publicClient.waitForTransactionReceipt({ hash: await ownerClient.writeContract(request) });
    assert.equal(deployed.status, "success");
    safeAddress = result;
    await testClient.setBalance({ address: safeAddress, value: SAFE_FUNDING });
    await testClient.setBalance({ address: OWNER.address, value: OWNER_FUNDING });

    tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-fork-"));
    process.env.HOME = tmpHome;
    delete process.env.ZERION_AGENT_TOKEN;
    const ows = await import("#zerion/utils/wallet/keystore.js");
    const config = await import("#zerion/utils/config.js");
    catalog = await import("#zerion/utils/chain/catalog.js");
    submit = await import("#zerion/utils/safe/submit.js");

    ows.importFromKey(OWNER_WALLET, OWNER_KEY, PASSPHRASE);
    config.saveAgentToken(OWNER_WALLET, ows.createAgentToken("fork-owner-agent", OWNER_WALLET, PASSPHRASE).token);
    catalog.__setCatalogForTests(new Map([["base", baseCatalogEntry(rpcUrl)]]));
    submit.__setSubmitDepsForTests({ getSafeChainInfo: async () => ({ txServiceUrl: null, shortName: null }) });
  });

  after(async () => {
    submit?.__setSubmitDepsForTests(null);
    catalog?.__setCatalogForTests(null);
    process.env.HOME = origHome;
    if (origEnvToken === undefined) delete process.env.ZERION_AGENT_TOKEN;
    else process.env.ZERION_AGENT_TOKEN = origEnvToken;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    if (anvil && anvil.exitCode === null && anvil.signalCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("executes a native send from a 1-of-1 Safe, with the owner paying gas", async () => {
    const balances = () =>
      Promise.all([safeAddress, RECIPIENT, OWNER.address].map((address) => publicClient.getBalance({ address })));
    const [safeBefore, recipientBefore, ownerBefore] = await balances();

    const result = await submit.submitSafeCalls({
      safe: { name: "fork-safe", address: safeAddress, signers: [OWNER_WALLET], executor: null },
      signer: { walletName: OWNER_WALLET, address: OWNER.address, readOnly: false },
      chain: "base",
      calls: [{ to: RECIPIENT, value: AMOUNT, data: "0x" }],
    });

    assert.equal(result.status, "executed");
    assert.match(result.txHash, /^0x[0-9a-f]{64}$/);
    assert.equal(result.confirmations, "1/1");
    assert.equal((await publicClient.getTransactionReceipt({ hash: result.txHash })).status, "success");

    const [safeAfter, recipientAfter, ownerAfter] = await balances();
    assert.equal(recipientAfter - recipientBefore, AMOUNT);
    assert.equal(safeBefore - safeAfter, AMOUNT);
    assert.ok(ownerAfter < ownerBefore, "the owner, as executor, pays the execTransaction gas");
  });
});
