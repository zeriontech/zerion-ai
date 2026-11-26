import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Public base vector (Safe 1.4.1 L2, USDC transfer at nonce 78); owner keys are synthetic test keys.
const BASE = JSON.parse(readFileSync(new URL("../../../../fixtures/safe/base-1.4.1-op0.json", import.meta.url), "utf8"));
const SAFE = BASE.typedData.domain.verifyingContract;
const CHAIN_ID = BASE.typedData.domain.chainId;
const CALL = { to: BASE.typedData.message.to, value: 0n, data: BASE.typedData.message.data };
const VECTOR_NONCE = 78n;

const OWNER = privateKeyToAccount(keccak256(toHex("zerion-safe-test-owner-1")));
const SECOND = privateKeyToAccount(keccak256(toHex("zerion-safe-test-owner-2")));
const THIRD = privateKeyToAccount(keccak256(toHex("zerion-safe-test-owner-3")));
const RELAYER = privateKeyToAccount(keccak256(toHex("zerion-safe-test-relayer")));
const SIGNER = { walletName: "owner-1", address: OWNER.address, readOnly: false };
const API_KEY = "SENTINEL-submit-test-safe-api-key";
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";

const EXEC_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);

let submitSafeCalls;
let __setSubmitDepsForTests;
let preApprovedSignature;
let SAFE_TX_TYPES;
let addReadonly;
let tmpHome;
let server;
const origHome = process.env.HOME;
const origSafeKey = process.env.SAFE_API_KEY;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-submit-"));
  process.env.HOME = tmpHome;
  ({ submitSafeCalls, __setSubmitDepsForTests } = await import("#zerion/utils/safe/submit.js"));
  ({ preApprovedSignature } = await import("#zerion/utils/safe/signatures.js"));
  ({ SAFE_TX_TYPES } = await import("#zerion/utils/safe/safe-tx.js"));
  ({ addReadonly } = await import("#zerion/utils/wallet/readonly.js"));
  addReadonly("ro-relayer", RELAYER.address);
});

beforeEach(() => {
  process.env.SAFE_API_KEY = API_KEY;
  rmSync(join(tmpHome, ".zerion", "safe-pending"), { recursive: true, force: true });
});

afterEach(async () => {
  __setSubmitDepsForTests(null);
  if (server) await server.close();
  server = null;
});

after(() => {
  process.env.HOME = origHome;
  if (origSafeKey === undefined) delete process.env.SAFE_API_KEY;
  else process.env.SAFE_API_KEY = origSafeKey;
  rmSync(tmpHome, { recursive: true, force: true });
});

function onchainHash(args) {
  const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce] = args;
  return hashTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: SAFE },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: { to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce },
  });
}

function stubClient({
  owners = [OWNER.address],
  threshold = 1,
  version = "1.4.1",
  nonces = [VECTOR_NONCE],
  hashOverride,
  balances = {},
} = {}) {
  const calls = { broadcasts: [], nonceReads: 0, estimateGas: [] };
  const client = {
    calls,
    getCode: async () => "0x6080",
    getStorageAt: async () => `0x${"00".repeat(32)}`,
    readContract: async ({ functionName, args }) => {
      switch (functionName) {
        case "VERSION":
          return version;
        case "getOwners":
          return owners;
        case "getThreshold":
          return BigInt(threshold);
        case "nonce":
          calls.nonceReads += 1;
          return nonces[Math.min(calls.nonceReads - 1, nonces.length - 1)];
        case "getModulesPaginated":
          return [[], SENTINEL_MODULES];
        case "getTransactionHash":
          return hashOverride ?? onchainHash(args);
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async (req) => {
      calls.estimateGas.push(req);
      return 50_000n;
    },
    getBalance: async ({ address }) => balances[getAddress(address)] ?? 10n ** 18n,
    getTransactionCount: async () => 7,
    sendRawTransaction: async ({ serializedTransaction }) => {
      calls.broadcasts.push(serializedTransaction);
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async ({ hash }) => ({ status: "success", blockNumber: 1n, gasUsed: 80_000n, hash }),
  };
  return client;
}

async function startTxService({ onPost = () => ({ status: 201, store: true }), queued = [], getTxStatus } = {}) {
  const state = { posts: [], stored: new Map(), authHeaders: [] };
  const srv = createServer((req, res) => {
    state.authHeaders.push(req.headers.authorization);
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(typeof body === "string" ? body : JSON.stringify(body ?? {}));
      };
      if (req.method === "POST") {
        const body = JSON.parse(raw);
        state.posts.push(body);
        const reply = onPost({ n: state.posts.length, body });
        if (reply.store) state.stored.set(body.contractTransactionHash, { safeTxHash: body.contractTransactionHash });
        return send(reply.status, reply.body);
      }
      if (url.pathname === `/api/v1/safes/${SAFE}/multisig-transactions/`) {
        const nonceGte = Number(url.searchParams.get("nonce__gte") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const page = queued.filter((tx) => tx.nonce >= nonceGte).sort((a, b) => a.nonce - b.nonce).slice(0, limit);
        return send(200, { results: page });
      }
      const match = url.pathname.match(/^\/api\/v1\/multisig-transactions\/(0x[0-9a-fA-F]+)\/$/);
      if (match && getTxStatus) return send(getTxStatus, "Service Unavailable");
      if (match && state.stored.has(match[1])) return send(200, state.stored.get(match[1]));
      return send(404, { detail: "Not found." });
    });
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${srv.address().port}`;
  state.close = () => new Promise((resolve) => (srv.listening ? srv.close(() => resolve()) : resolve()));
  server = state;
  return state;
}

function install({ client, txServiceUrl = null, shortName = "base", policyDeny = false, webApp } = {}) {
  const spies = { signer: [], policies: [], signedTxs: [], webApp: [] };
  __setSubmitDepsForTests({
    resolveChain: async () => ({ chainIdNum: CHAIN_ID }),
    getPublicClient: async () => client,
    getSafeChainInfo: async () => ({ txServiceUrl, shortName }),
    enforceExecutablePolicies: async (txInfo) => {
      spies.policies.push(txInfo);
      if (policyDeny) throw Object.assign(new Error("Blocked by policy"), { code: "policy_denied" });
    },
    signSafeTxAsOwner: async (args) => {
      spies.signer.push(args);
      return {
        owner: getAddress(args.signer.address),
        signature: await OWNER.signTypedData(args.typedData),
        signMode: args.signMode,
        signedVia: args.route,
      };
    },
    requireAgentToken: async () => "agent-token",
    signAndSerialize: async (tx, chain, walletName) => {
      spies.signedTxs.push({ tx, chain, walletName });
      const account = { "owner-1": OWNER, "owner-2": SECOND, relayer: RELAYER }[walletName];
      return account.signTransaction(tx);
    },
    signViaWebApp: async (args) => {
      spies.webApp.push(args);
      return webApp ?? { status: "completed", hashes: [`0x${"ab".repeat(32)}`] };
    },
    keystoreEvmAddress: (name) => ({ "owner-2": SECOND.address, relayer: RELAYER.address })[name] ?? (() => {
      throw new Error(`wallet ${name} not found`);
    })(),
  });
  return spies;
}

async function quiet(fn) {
  const saved = process.stderr.write;
  let stderr = "";
  process.stderr.write = (chunk, ...rest) => {
    if (typeof chunk !== "string") return saved.call(process.stderr, chunk, ...rest);
    stderr += chunk;
    return true;
  };
  try {
    return { value: await fn(), stderr };
  } catch (err) {
    err.stderr = stderr;
    throw err;
  } finally {
    process.stderr.write = saved;
  }
}

function submit({ safe = { name: "treasury", address: SAFE, signers: ["owner-1"], executor: null }, calls = [CALL], flags = {} } = {}) {
  return quiet(() => submitSafeCalls({ safe, signer: SIGNER, chain: "base", calls, usdValue: 1, flags }));
}

function broadcastSignatures(client) {
  assert.equal(client.calls.broadcasts.length, 1);
  const tx = parseTransaction(client.calls.broadcasts[0]);
  assert.equal(getAddress(tx.to), SAFE);
  const { functionName, args } = decodeFunctionData({ abi: EXEC_ABI, data: tx.data });
  assert.equal(functionName, "execTransaction");
  assert.equal(getAddress(args[0]), CALL.to);
  assert.equal(args[2], CALL.data);
  return args[9];
}

function receiptPath(safeTxHash) {
  return join(tmpHome, ".zerion", "safe-pending", SAFE, String(CHAIN_ID), `${safeTxHash}.json`);
}

describe("submitSafeCalls pre-flight failures never reach the owner signer", () => {
  const cases = [
    {
      name: "more than one call",
      code: "safe_operation_unsupported",
      setup: () => install({ client: stubClient() }),
      run: () => submit({ calls: [CALL, CALL] }),
    },
    {
      name: "calldata that is not hex",
      code: "safe_call_invalid",
      setup: () => install({ client: stubClient() }),
      run: () => submit({ calls: [{ ...CALL, data: "transfer(alice)" }] }),
    },
    {
      name: "signer no longer an owner",
      code: "safe_signer_not_owner",
      setup: () => install({ client: stubClient({ owners: [SECOND.address, THIRD.address] }) }),
    },
    {
      name: "unsupported Safe version",
      code: "safe_version_unsupported",
      setup: () => install({ client: stubClient({ version: "1.1.1" }) }),
    },
    {
      name: "policy deny on the inner call",
      code: "policy_denied",
      setup: () => install({ client: stubClient(), policyDeny: true }),
    },
    {
      name: "local hash differs from on-chain getTransactionHash",
      code: "safe_hash_mismatch",
      setup: () => install({ client: stubClient({ hashOverride: `0x${"00".repeat(32)}` }) }),
    },
    {
      name: "Path C: threshold unreachable and no tx-service",
      code: "safe_threshold_unreachable_no_tx_service",
      setup: () => install({ client: stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 2 }) }),
    },
    {
      name: "Path C: a 2-of-3 whose executor is a second owner, with no tx-service",
      code: "safe_threshold_unreachable_no_tx_service",
      setup: () => install({ client: stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 2 }) }),
      run: () => submit({ safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "owner-2" } }),
    },
    {
      name: "executor cannot pay execTransaction gas",
      code: "safe_executor_insufficient_gas",
      setup: () => install({ client: stubClient({ balances: { [OWNER.address]: 0n } }) }),
    },
    {
      name: "explicit --nonce ahead of the chain on the execute path with no tx-service",
      code: "safe_nonce_not_executable",
      setup: () => install({ client: stubClient() }),
      run: () => submit({ flags: { nonce: "80" } }),
    },
  ];

  for (const { name, code, setup, run = () => submit() } of cases) {
    it(`${name} → ${code}`, async () => {
      const spies = setup();
      await assert.rejects(run(), (err) => err.code === code);
      assert.equal(spies.signer.length, 0);
    });
  }

  it("runs the policy check on the inner call with the signer's wallet", async () => {
    const spies = install({ client: stubClient() });
    await submit();
    assert.deepEqual(spies.policies, [{ ...CALL, chain: "base", walletName: "owner-1" }]);
  });
});

describe("submitSafeCalls on a tx-service chain without a Safe API key", () => {
  const QUEUED_AT_ONCHAIN_NONCE = [{ safeTxHash: `0x${"cd".repeat(32)}`, nonce: 78, confirmations: [] }];

  for (const flags of [{}, { nonce: "78" }, { nonce: "next" }]) {
    it(`a 1-of-1 with ${JSON.stringify(flags)} executes at the on-chain nonce without asking the service, and warns`, async () => {
      delete process.env.SAFE_API_KEY;
      const service = await startTxService({ queued: QUEUED_AT_ONCHAIN_NONCE });
      const client = stubClient();
      const spies = install({ client, txServiceUrl: service.baseUrl });

      const { value: result, stderr } = await submit({ flags });

      assert.equal(service.authHeaders.length, 0);
      assert.equal(spies.signer.length, 1);
      assert.equal(client.calls.broadcasts.length, 1);
      assert.equal(result.status, "executed");
      assert.equal(result.nonce, "78");
      assert.equal(result.safeTxHash, BASE.safeTxHash);
      assert.match(stderr, new RegExp(`WARNING: no Safe API key is set, so queued proposals for Safe ${SAFE} on base were not checked`));
    });
  }

  const twoOfThree = () => stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 2 });
  for (const { name, client, flags } of [
    { name: "a 1-of-1 with --propose-only", client: stubClient, flags: { proposeOnly: true } },
    { name: "a 1-of-1 whose --nonce is ahead of the chain, so it would propose", client: stubClient, flags: { nonce: "80" } },
    { name: "a 2-of-3", client: twoOfThree, flags: {} },
    { name: "a 2-of-3 with --propose-only", client: twoOfThree, flags: { proposeOnly: true } },
  ]) {
    it(`${name} fails with safe_api_key_missing before signing`, async () => {
      delete process.env.SAFE_API_KEY;
      const service = await startTxService();
      const stub = client();
      const spies = install({ client: stub, txServiceUrl: service.baseUrl });

      await assert.rejects(submit({ flags }), (err) => err.code === "safe_api_key_missing");

      assert.equal(spies.signer.length, 0);
      assert.equal(service.authHeaders.length, 0);
      assert.equal(stub.calls.broadcasts.length, 0);
    });
  }
});

describe("submitSafeCalls Path A: execute", () => {
  it("1-of-1 with a non-owner keystore executor broadcasts execTransaction carrying the owner's EIP-712 signature", async () => {
    const client = stubClient();
    const spies = install({ client });
    const { value: result } = await submit({
      safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "relayer" },
    });

    assert.equal(spies.signer.length, 1);
    const [signArgs] = spies.signer;
    assert.equal(signArgs.safeTxHash, BASE.safeTxHash);
    assert.equal(signArgs.chainIdNum, CHAIN_ID);
    assert.equal(signArgs.typedData.domain.chainId, CHAIN_ID);

    const ownerSignature = await OWNER.signTypedData(BASE.typedData);
    assert.equal(broadcastSignatures(client), ownerSignature);
    assert.equal(spies.signedTxs[0].walletName, "relayer");

    assert.equal(result.status, "executed");
    assert.equal(result.confirmations, "1/1");
    assert.equal(result.txHash, keccak256(client.calls.broadcasts[0]));
    assert.equal(result.safeTxHash, BASE.safeTxHash);
    assert.equal(result.nonce, "78");
    assert.equal(result.signedVia, "local");
    assert.equal(result.signMode, "typed");
    assert.equal(result.route, "auto-sign");
  });

  it("1-of-1 executed by the signer itself uses the signer's v=1 form and no second signature", async () => {
    const client = stubClient();
    install({ client });
    const { value: result } = await submit();
    assert.equal(broadcastSignatures(client), preApprovedSignature(OWNER.address));
    assert.equal(result.confirmations, "1/1");
  });

  it("2-of-3 whose executor is a second owner proposes the signer's signature and does not execute", async () => {
    const service = await startTxService();
    const client = stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 2 });
    const spies = install({ client, txServiceUrl: service.baseUrl });
    const { value: result } = await submit({
      safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "owner-2" },
    });

    assert.equal(client.calls.broadcasts.length, 0);
    assert.equal(spies.signedTxs.length, 0);
    assert.equal(service.posts.length, 1);
    assert.equal(service.posts[0].signature, await OWNER.signTypedData(BASE.typedData));
    assert.equal(result.status, "proposed");
    assert.equal(result.confirmations, "1/2");
  });

  it("1-of-3 with an owner executor executes with only the signer's signature", async () => {
    const client = stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 1 });
    install({ client });
    const { value: result } = await submit({
      safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "owner-2" },
    });
    assert.equal(broadcastSignatures(client), await OWNER.signTypedData(BASE.typedData));
    assert.equal(result.confirmations, "1/1");
  });

  it("a read-only executor executes through one web-app entry labelled with the short safeTxHash", async () => {
    const client = stubClient();
    const spies = install({ client });
    const { value: result } = await submit({
      safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "ro-relayer" },
    });
    assert.equal(client.calls.broadcasts.length, 0);
    assert.equal(spies.webApp.length, 1);
    const [{ address, transactions }] = spies.webApp;
    assert.equal(address, RELAYER.address);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].label, `Execute Safe tx ${BASE.safeTxHash.slice(0, 10)}`);
    const { args } = decodeFunctionData({ abi: EXEC_ABI, data: transactions[0].evm.data });
    assert.equal(args[9], await OWNER.signTypedData(BASE.typedData));
    assert.equal(result.txHash, `0x${"ab".repeat(32)}`);
  });

  it("a receipt write that fails after the broadcast warns and still returns the executed result", async () => {
    mkdirSync(join(tmpHome, ".zerion"), { recursive: true });
    writeFileSync(join(tmpHome, ".zerion", "safe-pending"), "not a directory");
    const client = stubClient();
    install({ client });
    const { value: result, stderr } = await submit();
    assert.equal(client.calls.broadcasts.length, 1);
    assert.equal(result.status, "executed");
    assert.equal(result.txHash, keccak256(client.calls.broadcasts[0]));
    assert.match(stderr, /WARNING: the Safe transaction was executed, but its local receipt could not be written to .*safe-pending/);
  });

  it("prices execTransaction with fees read after the owner signature, not the pre-flight fees", async () => {
    const client = stubClient();
    let feeReads = 0;
    client.estimateFeesPerGas = async () => {
      feeReads += 1;
      return feeReads === 1
        ? { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }
        : { maxFeePerGas: 7_000_000_000n, maxPriorityFeePerGas: 2_000_000n };
    };
    const spies = install({ client });
    await submit();
    assert.equal(feeReads, 2);
    assert.equal(spies.signedTxs[0].tx.maxFeePerGas, 7_000_000_000n);
    assert.equal(spies.signedTxs[0].tx.maxPriorityFeePerGas, 2_000_000n);
  });

  it("writes the 0600 pending receipt with the documented keys at the documented path", async () => {
    install({ client: stubClient() });
    await submit({ safe: { name: "treasury", address: SAFE, signers: ["owner-1"], executor: "relayer" } });

    const path = receiptPath(BASE.safeTxHash);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(Object.keys(receipt).sort(), ["origin", "safeTx", "signatures", "status"]);
    assert.deepEqual(receipt.safeTx, BASE.typedData);
    assert.deepEqual(receipt.signatures, { [OWNER.address]: await OWNER.signTypedData(BASE.typedData) });
    assert.equal(receipt.origin, "zerion-cli");
    assert.equal(receipt.status, "executed");
  });
});

describe("submitSafeCalls Path B: propose", () => {
  const twoOfThree = () => stubClient({ owners: [OWNER.address, SECOND.address, THIRD.address], threshold: 2 });

  it("2-of-3 without an owner executor proposes exactly once with the pinned body and the app link", async () => {
    const service = await startTxService();
    const client = twoOfThree();
    install({ client, txServiceUrl: service.baseUrl, shortName: "base" });
    const { value: result } = await submit();

    assert.equal(service.posts.length, 1);
    assert.deepEqual(service.posts[0], {
      to: CALL.to,
      value: "0",
      data: CALL.data,
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: 78,
      contractTransactionHash: BASE.safeTxHash,
      sender: OWNER.address,
      signature: await OWNER.signTypedData(BASE.typedData),
      origin: "zerion-cli",
    });
    assert.ok(service.authHeaders.every((h) => h === `Bearer ${API_KEY}`));
    assert.equal(client.calls.broadcasts.length, 0);

    assert.equal(result.status, "proposed");
    assert.equal(result.confirmations, "1/2");
    assert.equal(
      result.link,
      `https://app.safe.global/transactions/tx?safe=base:${SAFE}&id=multisig_${SAFE}_${BASE.safeTxHash}`
    );
    assert.equal(Object.hasOwn(result, "txHash"), false);

    const receipt = JSON.parse(readFileSync(receiptPath(BASE.safeTxHash), "utf8"));
    assert.equal(receipt.status, "proposed");
  });

  it("link is null when the chain has no shortName", async () => {
    const service = await startTxService();
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl, shortName: null });
    const { value: result } = await submit();
    assert.equal(result.link, null);
  });

  it("--propose-only forces propose on a 1-of-1", async () => {
    const service = await startTxService();
    const client = stubClient();
    install({ client, txServiceUrl: service.baseUrl });
    const { value: result } = await submit({ flags: { proposeOnly: true } });
    assert.equal(service.posts.length, 1);
    assert.equal(client.calls.broadcasts.length, 0);
    assert.equal(result.status, "proposed");
    assert.equal(result.confirmations, "1/1");
  });

  it("a 1-of-1 whose default nonce is ahead of the chain because of the queue proposes instead of executing", async () => {
    const service = await startTxService({ queued: [{ safeTxHash: `0x${"cd".repeat(32)}`, nonce: 78, confirmations: [] }] });
    const client = stubClient();
    install({ client, txServiceUrl: service.baseUrl });
    const { value: result, stderr } = await submit();
    assert.equal(result.status, "proposed");
    assert.equal(result.nonce, "79");
    assert.equal(service.posts.length, 1);
    assert.equal(client.calls.broadcasts.length, 0);
    assert.match(stderr, /proposing instead of executing/);
  });

  it("--nonce N on a queued nonce warns with the conflicting safeTxHash", async () => {
    const conflicting = `0x${"cd".repeat(32)}`;
    const service = await startTxService({ queued: [{ safeTxHash: conflicting, nonce: 78, confirmations: [] }] });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    const { stderr } = await submit({ flags: { nonce: "78" } });
    assert.match(stderr, new RegExp(`WARNING: nonce 78 .*${conflicting}`));
  });

  const queuedTx = (nonce, i) => ({ safeTxHash: toHex(BigInt(i) + 1n, { size: 32 }), nonce, confirmations: [] });

  it("120 stale queue entries ahead of the live one do not hide the highest queued nonce", async () => {
    const stale = Array.from({ length: 120 }, (_, i) => queuedTx(i % 78, i));
    const service = await startTxService({ queued: [...stale, queuedTx(78, 500)] });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    const { value: result } = await submit();
    assert.equal(result.nonce, "79");
  });

  it("a full queue page at or above the on-chain nonce fails pre-flight with safe_queue_truncated", async () => {
    const live = Array.from({ length: 100 }, (_, i) => queuedTx(78 + i, i));
    const service = await startTxService({ queued: live });
    const spies = install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    await assert.rejects(submit(), (err) => err.code === "safe_queue_truncated");
    assert.equal(spies.signer.length, 0);
    assert.equal(service.posts.length, 0);
  });

  it("--nonce bypasses the truncated-queue refusal", async () => {
    const live = Array.from({ length: 100 }, (_, i) => queuedTx(78 + i, i));
    const service = await startTxService({ queued: live });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    const { value: result } = await submit({ flags: { nonce: "next" } });
    assert.equal(result.nonce, "78");
    assert.equal(result.status, "proposed");
  });

  it("a propose error the service actually stored is reported as proposed after a GET", async () => {
    const service = await startTxService({ onPost: () => ({ status: 400, store: true, body: { detail: "bad" } }) });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    const { value: result } = await submit();
    assert.equal(service.posts.length, 1);
    assert.equal(result.status, "proposed");
  });

  it("a propose error whose follow-up GET also fails is reported as outcome unknown, with no receipt", async () => {
    const service = await startTxService({
      onPost: () => ({ status: 400, store: false, body: { detail: "bad" } }),
      getTxStatus: 503,
    });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    await assert.rejects(
      submit(),
      (err) => err.code === "safe_tx_service_error" && /outcome is unknown/i.test(err.suggestion) && /zerion safe queue/.test(err.suggestion)
    );
    assert.equal(service.posts.length, 1);
    assert.throws(() => statSync(receiptPath(BASE.safeTxHash)), { code: "ENOENT" });
  });

  it("a propose error the service did not store fails with safe_tx_service_error and writes no receipt", async () => {
    const service = await startTxService({ onPost: () => ({ status: 400, store: false, body: { detail: "bad" } }) });
    install({ client: twoOfThree(), txServiceUrl: service.baseUrl });
    await assert.rejects(submit(), (err) => err.code === "safe_tx_service_error");
    assert.equal(service.posts.length, 1);
    assert.throws(() => statSync(receiptPath(BASE.safeTxHash)), { code: "ENOENT" });
  });
});

describe("submitSafeCalls nonce re-read", () => {
  it("a nonce used between signing and submission is neither executed nor proposed", async () => {
    const service = await startTxService();
    const client = stubClient({ nonces: [VECTOR_NONCE, VECTOR_NONCE + 1n] });
    const spies = install({ client, txServiceUrl: service.baseUrl });
    await assert.rejects(submit(), (err) => err.code === "safe_nonce_stale" && err.nonce === "78");
    assert.equal(spies.signer.length, 1);
    assert.equal(client.calls.broadcasts.length, 0);
    assert.equal(service.posts.length, 0);
  });
});
