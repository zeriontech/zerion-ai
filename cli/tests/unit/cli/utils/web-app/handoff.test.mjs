// Unit coverage for the web-app handoff helpers: codec round-trip,
// TransactionEVM field mapping, message-request shaping, and link construction.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  encodePayload,
  toTransactionEVM,
  toSolanaTransaction,
  buildTransactionLink,
  toPersonalSignRequest,
  toTypedDataSignRequest,
  toSolanaMessageRequest,
  buildMessageLink,
  CLI_TRANSACTION_PATH,
  CLI_MESSAGE_PATH,
} from "#zerion/utils/web-app/handoff.js";

// Decode helper mirroring what the web app must implement (the exact inverse).
function decodePayload(token) {
  return JSON.parse(inflateRawSync(Buffer.from(token, "base64url")).toString());
}

describe("encodePayload", () => {
  it("round-trips through raw inflate to a deep-equal payload", () => {
    const payload = {
      version: 1,
      transactions: [{ evm: { to: "0xabc", value: "0x0" }, label: "Send 1 ETH" }],
      port: 54321,
    };
    assert.deepEqual(decodePayload(encodePayload(payload)), payload);
  });

  it("produces base64url output (no +, /, or = padding)", () => {
    const token = encodePayload({ version: 1, transactions: [] });
    assert.ok(!/[+/=]/.test(token), `token had non-url-safe chars: ${token}`);
  });
});

describe("toTransactionEVM", () => {
  const from = "0x52Fb91492000F2a900a6b75B37D588AB37378e59";

  it("maps a viem-shape tx to hex strings with fees null", () => {
    const tx = {
      type: "eip1559",
      to: "0xRecipient",
      value: 1000000000000000n,
      data: "0x",
      gas: 21000n,
      nonce: 7,
    };
    const evm = toTransactionEVM(tx, { chainIdNum: 8453, from });
    assert.equal(evm.type, "0x2");
    assert.equal(evm.from, from);
    assert.equal(evm.to, "0xRecipient");
    assert.equal(evm.nonce, "0x7");
    assert.equal(evm.chainId, "0x2105"); // 8453
    assert.equal(evm.gas, "0x5208"); // 21000
    assert.equal(evm.value, "0x38d7ea4c68000");
    assert.equal(evm.data, "0x");
    assert.equal(evm.gasPrice, null);
    assert.equal(evm.maxFee, null);
    assert.equal(evm.maxPriorityFee, null);
    assert.equal(evm.customData, null);
  });

  it("passes through an API-shape tx (hex + chain_id/from) and applies nonce override", () => {
    const apiTx = {
      type: "0x2",
      from,
      to: "0xRouter",
      data: "0xdeadbeef",
      value: "0x0",
      gas: "0x30000",
      chain_id: "0x1",
      nonce: "0x0",
    };
    const evm = toTransactionEVM(apiTx, { chainIdNum: 1, from, nonce: 42 });
    assert.equal(evm.to, "0xRouter");
    assert.equal(evm.data, "0xdeadbeef");
    assert.equal(evm.gas, "0x30000");
    assert.equal(evm.chainId, "0x1");
    assert.equal(evm.nonce, "0x2a"); // override wins over tx.nonce "0x0"
    assert.equal(evm.maxFee, null);
  });

  it("defaults empty data to 0x and missing value to 0x0", () => {
    const evm = toTransactionEVM(
      { type: "eip1559", to: "0xabc", gas: 21000n, nonce: 0 },
      { chainIdNum: 1, from }
    );
    assert.equal(evm.data, "0x");
    assert.equal(evm.value, "0x0");
    assert.equal(evm.nonce, "0x0");
  });

  it("throws when tx.from disagrees with the signer address", () => {
    assert.throws(
      () =>
        toTransactionEVM(
          { type: "0x2", from: "0xDEADBEEFdeadbeefDEADbeefdeadBEEFdeadBEEF", to: "0x1" },
          { chainIdNum: 1, from }
        ),
      /does not match signer/
    );
  });

  it("accepts a case-insensitive from match", () => {
    const evm = toTransactionEVM(
      { type: "0x2", from: from.toLowerCase(), to: "0x1", nonce: 1 },
      { chainIdNum: 1, from }
    );
    assert.equal(evm.from, from);
  });
});

describe("toSolanaTransaction", () => {
  it("wraps a non-empty base64 raw tx", () => {
    assert.deepEqual(toSolanaTransaction("AQAB..."), { raw: "AQAB..." });
  });

  it("rejects an empty or non-string raw tx", () => {
    assert.throws(() => toSolanaTransaction(""), /non-empty base64/);
    assert.throws(() => toSolanaTransaction(null), /non-empty base64/);
  });
});

describe("buildTransactionLink (Solana entry)", () => {
  it("carries a solana entry through the payload with a base58 address", () => {
    const address = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
    const transactions = [{ solana: toSolanaTransaction("cmF3dHg="), label: "Swap SOL → USDC" }];
    const url = buildTransactionLink({ base: "https://app.zerion.io", address, transactions, port: 5000 });
    const parsed = new URL(url);
    assert.equal(parsed.pathname, CLI_TRANSACTION_PATH);
    assert.equal(parsed.searchParams.get("address"), address);
    const payload = decodePayload(parsed.hash.replace(/^#tx=/, ""));
    assert.deepEqual(payload.transactions, transactions);
  });
});

describe("buildTransactionLink", () => {
  const address = "0x52Fb91492000F2a900a6b75B37D588AB37378e59";
  const transactions = [{ evm: { to: "0xabc" }, label: "Send" }];

  it("puts address in the query and the payload in the fragment", () => {
    const url = buildTransactionLink({
      base: "https://app.zerion.io",
      address,
      transactions,
      port: 5000,
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://app.zerion.io");
    assert.equal(parsed.pathname, CLI_TRANSACTION_PATH);
    assert.equal(parsed.searchParams.get("address"), address);

    const token = parsed.hash.replace(/^#tx=/, "");
    const payload = decodePayload(token);
    assert.equal(payload.version, 1);
    assert.equal(payload.port, 5000);
    assert.deepEqual(payload.transactions, transactions);
  });

  it("omits port from the payload when not provided", () => {
    const url = buildTransactionLink({ base: "https://app.zerion.io", address, transactions });
    const payload = decodePayload(new URL(url).hash.replace(/^#tx=/, ""));
    assert.ok(!("port" in payload));
  });
});

describe("toPersonalSignRequest", () => {
  it("hex-encodes a utf8 message and keeps the original as display", () => {
    const req = toPersonalSignRequest({ message: "hello", encoding: "utf8", chainIdNum: 8453 });
    assert.equal(req.kind, "personal");
    assert.equal(req.raw, "0x68656c6c6f");
    assert.equal(req.display, "hello");
    assert.equal(req.chainId, "0x2105");
  });

  it("normalizes hex input to 0x-prefixed raw with no display", () => {
    const req = toPersonalSignRequest({ message: "deadbeef", encoding: "hex", chainIdNum: 1 });
    assert.equal(req.raw, "0xdeadbeef");
    assert.ok(!("display" in req));

    const prefixed = toPersonalSignRequest({ message: "0xdeadbeef", encoding: "hex", chainIdNum: 1 });
    assert.equal(prefixed.raw, "0xdeadbeef");
  });

  it("rejects malformed hex input", () => {
    assert.throws(
      () => toPersonalSignRequest({ message: "0xnothex", encoding: "hex", chainIdNum: 1 }),
      /hex/
    );
    assert.throws(
      () => toPersonalSignRequest({ message: "0xabc", encoding: "hex", chainIdNum: 1 }),
      /even-length/
    );
  });

  it("emits a null chainId when the chain id is unknown", () => {
    const req = toPersonalSignRequest({ message: "hi", encoding: "utf8" });
    assert.equal(req.chainId, null);
  });
});

describe("toTypedDataSignRequest", () => {
  const typedData = {
    domain: { name: "Test", chainId: 1 },
    types: { Mail: [{ name: "contents", type: "string" }] },
    primaryType: "Mail",
    message: { contents: "hi" },
  };

  it("wraps the typed data with kind and hex chainId", () => {
    const req = toTypedDataSignRequest(typedData, { chainIdNum: 1 });
    assert.equal(req.kind, "typedData");
    assert.deepEqual(req.typedData, typedData);
    assert.equal(req.chainId, "0x1");
  });
});

describe("toSolanaMessageRequest", () => {
  it("hex-encodes a utf8 message, keeps display, and carries no chainId", () => {
    const req = toSolanaMessageRequest({ message: "hello", encoding: "utf8" });
    assert.equal(req.kind, "solanaMessage");
    assert.equal(req.raw, "0x68656c6c6f");
    assert.equal(req.display, "hello");
    assert.ok(!("chainId" in req));
  });

  it("normalizes hex input to 0x-prefixed raw with no display", () => {
    const req = toSolanaMessageRequest({ message: "deadbeef", encoding: "hex" });
    assert.equal(req.raw, "0xdeadbeef");
    assert.ok(!("display" in req));
  });

  it("rejects malformed hex input", () => {
    assert.throws(() => toSolanaMessageRequest({ message: "0xabc", encoding: "hex" }), /even-length/);
  });
});

describe("buildMessageLink", () => {
  const address = "0x52Fb91492000F2a900a6b75B37D588AB37378e59";
  const message = { kind: "personal", raw: "0x68656c6c6f", display: "hello", chainId: "0x1" };

  it("puts address in the query and the payload in the #msg fragment", () => {
    const url = buildMessageLink({
      base: "https://app.zerion.io",
      address,
      message,
      port: 5000,
      token: "abc123",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://app.zerion.io");
    assert.equal(parsed.pathname, CLI_MESSAGE_PATH);
    assert.equal(parsed.searchParams.get("address"), address);

    const payload = decodePayload(parsed.hash.replace(/^#msg=/, ""));
    assert.equal(payload.version, 1);
    assert.equal(payload.port, 5000);
    assert.equal(payload.token, "abc123");
    assert.deepEqual(payload.message, message);
  });

  it("omits port and token from the payload when not provided", () => {
    const url = buildMessageLink({ base: "https://app.zerion.io", address, message });
    const payload = decodePayload(new URL(url).hash.replace(/^#msg=/, ""));
    assert.ok(!("port" in payload));
    assert.ok(!("token" in payload));
  });
});
