// Integration coverage for signViaWebApp / signMessageViaWebApp: this test
// plays the web app — it reads the ephemeral port the CLI opened (from the
// printed link's payload) and POSTs callback events back, asserting the
// resolved result and that the server binds loopback only. Browser opening is
// suppressed via ZERION_NO_BROWSER.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";

process.env.ZERION_NO_BROWSER = "1";

const { signViaWebApp, signBundleViaWebApp, signMessageViaWebApp } = await import("#zerion/utils/web-app/handoff.js");
const { solanaReceiptAdapter, solanaMessageVerifier } = await import("#zerion/utils/chain/solana-handoff.js");
const { ed25519 } = await import("@noble/curves/ed25519");
const { PublicKey } = await import("@solana/web3.js");
const bs58 = (await import("bs58")).default;

const ADDRESS = "0x52Fb91492000F2a900a6b75B37D588AB37378e59";
const TRANSACTIONS = [{ evm: { to: "0xabc", value: "0x0" }, label: "Send 1 ETH" }];
const MESSAGE = { kind: "personal", raw: "0x68656c6c6f", display: "hello", chainId: "0x1" };

let stderrChunks;
let originalWrite;

beforeEach(() => {
  stderrChunks = [];
  originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

// Poll captured stderr until the CLI prints its web-app link, then pull the
// callback port out of the payload fragment.
async function waitForPort(path = "/cli/transaction", fragmentKey = "tx") {
  for (let i = 0; i < 200; i++) {
    const line = stderrChunks.find((c) => c.includes(`${path}?`));
    if (line) {
      const url = new URL(line.trim().split("\n").find((l) => l.includes(`${path}?`)));
      const token = url.hash.replace(new RegExp(`^#${fragmentKey}=`), "");
      const payload = JSON.parse(inflateRawSync(Buffer.from(token, "base64url")).toString());
      return payload.port;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`CLI never printed a ${path} link`);
}

async function postEvent(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 204);
}

describe("signViaWebApp", () => {
  it("resolves completed with hashes on a completed callback", async () => {
    const pending = signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "signed", index: 0, hash: "0xaaa" });
    await postEvent(port, { event: "completed", hashes: ["0xaaa"] });
    const result = await pending;
    assert.deepEqual(result, { status: "completed", hashes: ["0xaaa"] });
  });

  it("resolves rejected on a rejected callback", async () => {
    const pending = signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "rejected" });
    assert.deepEqual(await pending, { status: "rejected" });
  });

  it("resolves failed with failedIndex and partial hashes", async () => {
    const pending = signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "failed", failedIndex: 1, hashes: ["0xaaa"], error: "reverted" });
    assert.deepEqual(await pending, {
      status: "failed",
      failedIndex: 1,
      hashes: ["0xaaa"],
      error: "reverted",
    });
  });

  it("times out when no callback arrives", async () => {
    const start = Date.now();
    const result = await signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 1 });
    assert.deepEqual(result, { status: "timeout" });
    assert.ok(Date.now() - start >= 900, "should have waited ~1s before timing out");
  });

  it("answers the CORS preflight so the browser POST is allowed", async () => {
    const pending = signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 10 });
    const port = await waitForPort();
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods"), /POST/);
    await postEvent(port, { event: "completed", hashes: [] });
    await pending;
  });

  it("binds 127.0.0.1 only (loopback)", async () => {
    const pending = signViaWebApp({ address: ADDRESS, transactions: TRANSACTIONS, timeout: 10 });
    const port = await waitForPort();
    // The link the CLI printed must target the loopback callback.
    const link = stderrChunks.find((c) => c.includes("/cli/transaction?"));
    assert.ok(link, "expected a printed link");
    await postEvent(port, { event: "completed", hashes: [] });
    await pending;
  });
});

describe("signBundleViaWebApp (v2 grouped)", () => {
  const GROUPS = [
    [{ evm: { to: "0xA", value: "0x0" }, label: "Swap" }],
    [{ evm: { to: "0xB", value: "0x0" }, label: "Send" }],
  ];

  it("carries all groups into one v2 payload (groups field)", async () => {
    const pending = signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 10 });
    const port = await waitForPort();
    // The printed link's payload must be v2 with both groups under `groups`.
    const line = stderrChunks.find((c) => c.includes("/cli/transaction?"));
    const url = new URL(line.trim().split("\n").find((l) => l.includes("/cli/transaction?")));
    const payload = JSON.parse(inflateRawSync(Buffer.from(url.hash.replace(/^#tx=/, ""), "base64url")).toString());
    assert.equal(payload.version, 2);
    assert.ok(!("transactions" in payload), "v2 must not carry a `transactions` field");
    assert.equal(payload.groups.length, 2);
    await postEvent(port, {
      event: "summary",
      groups: [
        { group: 0, outcome: "completed", hashes: ["0xa"] },
        { group: 1, outcome: "completed", hashes: ["0xb"] },
      ],
    });
    await pending;
  });

  it("streams per-group terminals and resolves on the final summary", async () => {
    const pending = signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "signed", group: 0, index: 0, hash: "0xa" });
    await postEvent(port, { event: "group-completed", group: 0, hashes: ["0xa"] });
    // A skipped group maps to the CLI's per-group `rejected` status.
    await postEvent(port, { event: "group-skipped", group: 1 });
    await postEvent(port, {
      event: "summary",
      groups: [
        { group: 0, outcome: "completed", hashes: ["0xa"] },
        { group: 1, outcome: "skipped", hashes: [] },
      ],
    });
    const result = await pending;
    assert.equal(result.status, "partial");
    assert.equal(result.groups.length, 2);
    assert.deepEqual(result.groups[0], { status: "completed", hashes: ["0xa"] });
    assert.deepEqual(result.groups[1], { status: "rejected" });
  });

  it("merges the group-failed error text into the summary result", async () => {
    const pending = signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "group-completed", group: 0, hashes: ["0xa"] });
    await postEvent(port, {
      event: "group-failed",
      group: 1,
      failedIndex: 0,
      hashes: ["0xb"],
      error: "reverted on chain",
    });
    await postEvent(port, {
      event: "summary",
      groups: [
        { group: 0, outcome: "completed", hashes: ["0xa"] },
        { group: 1, outcome: "failed", hashes: ["0xb"] },
      ],
    });
    const result = await pending;
    assert.equal(result.status, "partial");
    assert.deepEqual(result.groups[0], { status: "completed", hashes: ["0xa"] });
    assert.deepEqual(result.groups[1], {
      status: "failed",
      hashes: ["0xb"],
      error: "reverted on chain",
    });
  });

  it("marks completed when every group completes and does NOT verify on-chain (relaxed)", async () => {
    const pending = signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, {
      event: "summary",
      groups: [
        { group: 0, outcome: "completed", hashes: ["0xa"] },
        { group: 1, outcome: "completed", hashes: ["0xb"] },
      ],
    });
    const result = await pending;
    assert.equal(result.status, "completed");
    const noted = stderrChunks.some((c) => c.includes("verification is relaxed") || c.includes("relaxed for bundles"));
    assert.ok(noted, "expected the relaxed-verification stderr note");
  });

  it("resolves rejected when the whole session is rejected", async () => {
    const pending = signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 10 });
    const port = await waitForPort();
    await postEvent(port, { event: "rejected" });
    const result = await pending;
    assert.equal(result.status, "rejected");
    assert.equal(result.groups.length, 2);
  });

  it("times out when no callback arrives", async () => {
    const result = await signBundleViaWebApp({ address: ADDRESS, groups: GROUPS, timeout: 1 });
    assert.equal(result.status, "timeout");
  });
});

describe("signViaWebApp (Solana)", () => {
  const SOL_ADDRESS = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
  const SOL_TX = [{ solana: { raw: "cmF3dHg=" }, label: "Swap SOL → USDC" }];

  it("verifies the returned signature via the receipt adapter and completes", async () => {
    const client = solanaReceiptAdapter({ getSignatureStatuses: async () => ({ value: [{ err: null }] }) });
    const pending = signViaWebApp({ address: SOL_ADDRESS, transactions: SOL_TX, timeout: 10, client });
    const port = await waitForPort();
    await postEvent(port, { event: "completed", hashes: ["5xSignatureBase58"] });
    assert.deepEqual(await pending, { status: "completed", hashes: ["5xSignatureBase58"] });
  });

  it("flips to failed when the Solana signature landed with an error", async () => {
    const client = solanaReceiptAdapter({ getSignatureStatuses: async () => ({ value: [{ err: { x: 1 } }] }) });
    const pending = signViaWebApp({ address: SOL_ADDRESS, transactions: SOL_TX, timeout: 10, client });
    const port = await waitForPort();
    await postEvent(port, { event: "completed", hashes: ["5xReverted"] });
    const result = await pending;
    assert.equal(result.status, "failed");
    assert.match(result.error, /reverted/);
  });
});

describe("signMessageViaWebApp (Solana)", () => {
  const waitForMessagePort = () => waitForPort("/cli/message", "msg");

  it("verifies a real ed25519 signature and completes", async () => {
    const priv = ed25519.utils.randomPrivateKey();
    const pub = ed25519.getPublicKey(priv);
    const address = new PublicKey(pub).toBase58();
    const messageBytes = Buffer.from("gm from the cli", "utf8");
    const message = { kind: "solanaMessage", raw: "0x" + messageBytes.toString("hex"), display: "gm from the cli" };
    const signature = bs58.encode(ed25519.sign(messageBytes, priv));

    const pending = signMessageViaWebApp({ address, message, timeout: 10, client: solanaMessageVerifier() });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature });
    assert.deepEqual(await pending, { status: "completed", signature });
  });

  it("fails a Solana message whose signature doesn't validate for the signer", async () => {
    const priv = ed25519.utils.randomPrivateKey();
    const address = new PublicKey(ed25519.getPublicKey(priv)).toBase58();
    const messageBytes = Buffer.from("gm", "utf8");
    const message = { kind: "solanaMessage", raw: "0x" + messageBytes.toString("hex"), display: "gm" };
    const forged = bs58.encode(ed25519.sign(messageBytes, ed25519.utils.randomPrivateKey()));

    const pending = signMessageViaWebApp({ address, message, timeout: 10, client: solanaMessageVerifier() });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature: forged });
    const result = await pending;
    assert.equal(result.status, "failed");
    assert.match(result.error, /verification failed/);
  });
});

describe("signMessageViaWebApp", () => {
  const waitForMessagePort = () => waitForPort("/cli/message", "msg");

  it("resolves completed with the signature on a completed callback", async () => {
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10 });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature: "0xsig" });
    assert.deepEqual(await pending, { status: "completed", signature: "0xsig" });
  });

  it("fails a completed callback that carries no signature", async () => {
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10 });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed" });
    const result = await pending;
    assert.equal(result.status, "failed");
    assert.match(result.error, /no signature/);
  });

  it("resolves rejected on a rejected callback", async () => {
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10 });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "rejected" });
    assert.deepEqual(await pending, { status: "rejected" });
  });

  it("resolves failed with the error from a failed callback", async () => {
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10 });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "failed", error: "user has no connected wallet" });
    assert.deepEqual(await pending, { status: "failed", error: "user has no connected wallet" });
  });

  it("times out when no callback arrives", async () => {
    const result = await signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 1 });
    assert.deepEqual(result, { status: "timeout" });
  });

  it("verifies the signature via the client and fails on a mismatch", async () => {
    const seen = [];
    const client = {
      verifyMessage: async (params) => {
        seen.push(params);
        return false;
      },
    };
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10, client });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature: "0xforged" });
    const result = await pending;
    assert.equal(result.status, "failed");
    assert.match(result.error, /verification failed/);
    assert.deepEqual(seen, [
      { address: ADDRESS, message: { raw: MESSAGE.raw }, signature: "0xforged" },
    ]);
  });

  it("verifies typed data via verifyTypedData and completes on a match", async () => {
    const typedData = {
      domain: { name: "Test", chainId: 1 },
      types: { Mail: [{ name: "contents", type: "string" }] },
      primaryType: "Mail",
      message: { contents: "hi" },
    };
    const seen = [];
    const client = {
      verifyTypedData: async (params) => {
        seen.push(params);
        return true;
      },
    };
    const pending = signMessageViaWebApp({
      address: ADDRESS,
      message: { kind: "typedData", typedData, chainId: "0x1" },
      timeout: 10,
      client,
    });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature: "0xsig" });
    assert.deepEqual(await pending, { status: "completed", signature: "0xsig" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].primaryType, "Mail");
    assert.equal(seen[0].signature, "0xsig");
    assert.equal(seen[0].address, ADDRESS);
  });

  it("degrades to unverified (still completed) when verification throws", async () => {
    const client = {
      verifyMessage: async () => {
        throw new Error("rpc down");
      },
    };
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10, client });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", signature: "0xsig" });
    assert.deepEqual(await pending, { status: "completed", signature: "0xsig" });
    const warned = stderrChunks.some((c) => c.includes("could not verify the signature"));
    assert.ok(warned, "expected an unverified warning on stderr");
  });

  it("ignores callbacks whose one-time token does not match", async () => {
    const pending = signMessageViaWebApp({ address: ADDRESS, message: MESSAGE, timeout: 10 });
    const port = await waitForMessagePort();
    await postEvent(port, { event: "completed", token: "not-the-token", signature: "0xforged" });
    // The forged event must be ignored; a token-less legit event still lands.
    await postEvent(port, { event: "rejected" });
    assert.deepEqual(await pending, { status: "rejected" });
  });
});
