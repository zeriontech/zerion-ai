import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-tx-service-"));
process.env.HOME = tmpHome;
delete process.env.SAFE_API_KEY;

const { createTxServiceClient, requireSafeApiKey } = await import("#zerion/utils/safe/tx-service.js");
const { setConfigValue, unsetConfigValue } = await import("#zerion/utils/config.js");

const SENTINEL_KEY = "SENTINEL-fake-safe-api-key-7f3a9c";

// Public base vector (base-1.4.1-op0.json): Safe 1.4.1 L2, USDC transfer, ExecutionSuccess safeTxHash.
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const SAFE_TX_HASH = "0x81c02e13c21dc26f71f1c94dc233c1dc7bf12d8189b458daab9f07cac64da066";
const MESSAGE = {
  to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  value: 0n,
  data: "0xa9059cbb00000000000000000000000029b66aa16b8fc99b2bd47c4030491e469ade297c000000000000000000000000000000000000000000000000000000000ee6b280",
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: 78n,
};
const SENDER = "0x29b66aa16b8fc99b2bd47c4030491e469ade297c";
const SIGNATURE = "0x" + "11".repeat(65);

function proposal() {
  return { safeAddress: SAFE, message: MESSAGE, safeTxHash: SAFE_TX_HASH, sender: SENDER, signature: SIGNATURE };
}

async function startStub({ onPost = () => ({ status: 201, store: true }), onGet } = {}) {
  const state = { stored: new Map(), posts: new Map(), authHeaders: [], postBodies: [] };
  const server = createServer((req, res) => {
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
        state.postBodies.push(body);
        const hash = body.contractTransactionHash;
        const n = (state.posts.get(hash) ?? 0) + 1;
        state.posts.set(hash, n);
        const reply = onPost({ n, req, body });
        if (reply.store) state.stored.set(hash, { safeTxHash: hash, nonce: body.nonce });
        return send(reply.status, reply.body);
      }
      if (onGet) {
        const reply = onGet({ url, req });
        if (reply) return send(reply.status, reply.body);
      }
      const match = url.pathname.match(/^\/api\/v1\/multisig-transactions\/(0x[0-9a-fA-F]+)\/$/);
      if (match && state.stored.has(match[1])) return send(200, state.stored.get(match[1]));
      return send(404, { detail: "Not found." });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
  return state;
}

function recordingSleep() {
  const delays = [];
  const sleep = async (ms) => {
    delays.push(ms);
  };
  return { delays, sleep };
}

describe("tx-service propose idempotency", () => {
  let stub;
  afterEach(() => stub?.close());

  it("500 on a POST the service stored → exists after the pre-retry GET, one POST, one stored tx", async () => {
    stub = await startStub({ onPost: () => ({ status: 500, store: true, body: "Internal Server Error" }) });
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep: recordingSleep().sleep });
    assert.deepEqual(await client.propose(proposal()), { status: "exists" });
    assert.equal(stub.posts.get(SAFE_TX_HASH), 1);
    assert.equal(stub.stored.size, 1);
  });

  it("429 then 201 → created with exactly two POSTs", async () => {
    stub = await startStub({
      onPost: ({ n }) => (n === 1 ? { status: 429, store: false } : { status: 201, store: true }),
    });
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep: recordingSleep().sleep });
    assert.deepEqual(await client.propose(proposal()), { status: "created" });
    assert.equal(stub.posts.get(SAFE_TX_HASH), 2);
    assert.equal(stub.stored.size, 1);
  });

  it("422 'already exists' → exists with one POST", async () => {
    stub = await startStub({
      onPost: () => ({
        status: 422,
        store: false,
        body: { nonFieldErrors: [`Tx with safe-tx-hash=${SAFE_TX_HASH} for safe=${SAFE} already exists`] },
      }),
    });
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep: recordingSleep().sleep });
    assert.deepEqual(await client.propose(proposal()), { status: "exists" });
    assert.equal(stub.posts.get(SAFE_TX_HASH), 1);
  });

  it("POST body carries the SafeTx message with string amounts and numeric operation/nonce", async () => {
    stub = await startStub();
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY });
    await client.propose(proposal());
    assert.deepEqual(stub.postBodies[0], {
      to: MESSAGE.to,
      value: "0",
      data: MESSAGE.data,
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: MESSAGE.gasToken,
      refundReceiver: MESSAGE.refundReceiver,
      nonce: 78,
      contractTransactionHash: SAFE_TX_HASH,
      sender: SENDER,
      signature: SIGNATURE,
      origin: "zerion-cli",
    });
  });
});

describe("tx-service retry backoff", () => {
  let stub;
  afterEach(() => stub?.close());

  it("a permanent 503 throws safe_tx_service_error after 5 POSTs, sleeping 1s, 2s, 4s, 8s plus jitter", async () => {
    stub = await startStub({ onPost: () => ({ status: 503, store: false, body: "unavailable" }) });
    const { delays, sleep } = recordingSleep();
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep });
    await assert.rejects(client.propose(proposal()), (err) => {
      assert.equal(err.code, "safe_tx_service_error");
      assert.equal(err.status, 503);
      return true;
    });
    assert.equal(stub.posts.get(SAFE_TX_HASH), 5);
    assert.equal(delays.length, 4);
    [1000, 2000, 4000, 8000].forEach((lower, i) => {
      assert.ok(delays[i] >= lower && delays[i] <= lower + 500, `delay ${i} = ${delays[i]}`);
    });
  });

  it("maxAttempts caps the POST count", async () => {
    stub = await startStub({ onPost: () => ({ status: 502, store: false }) });
    const client = createTxServiceClient({
      baseUrl: stub.baseUrl,
      apiKey: SENTINEL_KEY,
      sleep: recordingSleep().sleep,
      maxAttempts: 2,
    });
    await assert.rejects(client.propose(proposal()), { code: "safe_tx_service_error" });
    assert.equal(stub.posts.get(SAFE_TX_HASH), 2);
  });
});

describe("tx-service API key handling", () => {
  let stub;
  let stderr;
  let originalWrite;
  beforeEach(() => {
    stderr = "";
    originalWrite = process.stderr.write;
    process.stderr.write = (chunk, ...rest) => {
      stderr += String(chunk);
      return originalWrite.call(process.stderr, chunk, ...rest);
    };
  });
  afterEach(async () => {
    process.stderr.write = originalWrite;
    await stub?.close();
  });

  function assertNoKey(err) {
    assert.ok(err instanceof Error);
    assert.ok(!JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(SENTINEL_KEY), err.message);
    assert.ok(!String(err).includes(SENTINEL_KEY));
    return true;
  }

  it("every request sends the bearer key, and no failure path leaks it", async () => {
    const echo = ({ req }) => ({ detail: `bad auth: ${req.headers.authorization}` });
    stub = await startStub({
      onPost: ({ req, body }) => {
        if (body.nonce === 400) return { status: 400, store: false, body: echo({ req }) };
        return { status: 503, store: false, body: echo({ req }) };
      },
      onGet: ({ url, req }) => {
        if (url.pathname.startsWith(`/api/v1/safes/`)) return { status: 401, body: echo({ req }) };
        if (url.pathname.includes("0xdead")) return { status: 403, body: echo({ req }) };
        return null;
      },
    });
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep: recordingSleep().sleep });

    const fourXX = await client.propose({ ...proposal(), message: { ...MESSAGE, nonce: 400n } }).catch((e) => e);
    assert.equal(fourXX.status, 400);
    assert.match(fourXX.body, /Bearer \*\*\*/);
    assertNoKey(fourXX);

    const exhausted = await client.propose(proposal()).catch((e) => e);
    assert.equal(exhausted.status, 503);
    assertNoKey(exhausted);

    assertNoKey(await client.listQueued(SAFE).catch((e) => e));
    assertNoKey(await client.getTransaction("0xdead").catch((e) => e));

    assert.ok(stub.authHeaders.length > 0);
    for (const header of stub.authHeaders) assert.equal(header, `Bearer ${SENTINEL_KEY}`);
    await stub.close();

    const refused = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY, sleep: recordingSleep().sleep });
    const network = await refused.propose(proposal()).catch((e) => e);
    assert.equal(network.code, "safe_tx_service_error");
    assert.equal(network.status, null);
    assertNoKey(network);

    const echoingFetch = async (_url, init) => {
      throw new Error(`connect failed with ${init.headers.Authorization}`);
    };
    const thrown = createTxServiceClient({
      baseUrl: "http://127.0.0.1:9",
      apiKey: SENTINEL_KEY,
      fetchImpl: echoingFetch,
      sleep: recordingSleep().sleep,
    });
    assertNoKey(await thrown.propose(proposal()).catch((e) => e));
    assertNoKey(await thrown.getTransaction(SAFE_TX_HASH).catch((e) => e));

    assert.ok(!stderr.includes(SENTINEL_KEY));
  });
});

describe("tx-service reads", () => {
  let stub;
  afterEach(() => stub?.close());

  it("getTransaction returns null on 404 and listQueued maps the queue page", async () => {
    let queueSearch;
    stub = await startStub({
      onGet: ({ url }) => {
        if (!url.pathname.startsWith(`/api/v1/safes/${SAFE}/multisig-transactions/`)) return null;
        queueSearch = url.search;
        return {
          status: 200,
          body: {
            results: [
              {
                safeTxHash: SAFE_TX_HASH,
                nonce: 78,
                to: MESSAGE.to,
                value: "0",
                data: MESSAGE.data,
                operation: 0,
                confirmations: [{ owner: SENDER }],
                confirmationsRequired: 2,
              },
            ],
          },
        };
      },
    });
    const client = createTxServiceClient({ baseUrl: stub.baseUrl, apiKey: SENTINEL_KEY });
    assert.equal(await client.getTransaction(SAFE_TX_HASH), null);
    assert.deepEqual(await client.listQueued(SAFE, { nonceGte: 78 }), [
      {
        safeTxHash: SAFE_TX_HASH,
        nonce: 78,
        to: MESSAGE.to,
        value: "0",
        data: MESSAGE.data,
        operation: 0,
        confirmations: 1,
        confirmationsRequired: 2,
      },
    ]);
    assert.equal(queueSearch, "?executed=false&nonce__gte=78&ordering=nonce&limit=100");
  });
});

describe("requireSafeApiKey", () => {
  after(() => rmSync(tmpHome, { recursive: true, force: true }));
  afterEach(() => {
    delete process.env.SAFE_API_KEY;
    unsetConfigValue("safeApiKey");
  });

  const SERVICE = "https://tx-service.example/base";
  const cases = [
    { name: "no service, nothing set", txServiceUrl: null, env: null, config: null, expected: null },
    { name: "no service, both set", txServiceUrl: null, env: "env-key", config: "cfg-key", expected: null },
    { name: "service, nothing set", txServiceUrl: SERVICE, env: null, config: null, throws: "safe_api_key_missing" },
    { name: "service, env only", txServiceUrl: SERVICE, env: "env-key", config: null, expected: "env-key" },
    { name: "service, config only", txServiceUrl: SERVICE, env: null, config: "cfg-key", expected: "cfg-key" },
    { name: "service, both set → env wins", txServiceUrl: SERVICE, env: "env-key", config: "cfg-key", expected: "env-key" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      if (c.env) process.env.SAFE_API_KEY = c.env;
      if (c.config) setConfigValue("safeApiKey", c.config);
      if (c.throws) {
        assert.throws(() => requireSafeApiKey({ txServiceUrl: c.txServiceUrl }), (err) => {
          assert.equal(err.code, c.throws);
          assert.equal(err.suggestion, "Set one: zerion config set safeApiKey <key>  (or export SAFE_API_KEY=<key>)");
          return true;
        });
      } else {
        assert.equal(requireSafeApiKey({ txServiceUrl: c.txServiceUrl }), c.expected);
      }
    });
  }
});
