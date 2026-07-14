// Unit coverage for the Solana side of the web-app handoff: the receipt adapter
// (signature → success/reverted verdict) and the ed25519 message verifier
// (accepts the signature encodings a browser wallet might return).

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { solanaReceiptAdapter, solanaMessageVerifier } from "#zerion/utils/chain/solana-handoff.js";

describe("solanaReceiptAdapter", () => {
  const fakeConnection = (value) => ({
    getSignatureStatuses: async () => ({ value }),
  });

  it("maps a landed signature with no error to success", async () => {
    const adapter = solanaReceiptAdapter(fakeConnection([{ err: null, confirmationStatus: "confirmed" }]));
    assert.deepEqual(await adapter.getTransactionReceipt({ hash: "sig" }), { status: "success" });
  });

  it("maps a landed-with-error signature to reverted", async () => {
    const adapter = solanaReceiptAdapter(fakeConnection([{ err: { InstructionError: [0, "Custom"] } }]));
    assert.deepEqual(await adapter.getTransactionReceipt({ hash: "sig" }), { status: "reverted" });
  });

  it("throws when the signature isn't visible yet (drives verifyHashes retry)", async () => {
    const adapter = solanaReceiptAdapter(fakeConnection([null]));
    await assert.rejects(() => adapter.getTransactionReceipt({ hash: "sig" }), /not found yet/);
  });
});

describe("solanaMessageVerifier", () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  const address = new PublicKey(pub).toBase58();
  const messageBytes = Buffer.from("gm from the cli", "utf8");
  const raw = "0x" + messageBytes.toString("hex");
  const sig = ed25519.sign(messageBytes, priv);

  const verify = (signature) =>
    solanaMessageVerifier().verifyMessage({ address, message: { raw }, signature });

  it("accepts a valid base58 signature (the Solana convention)", async () => {
    assert.equal(await verify(bs58.encode(sig)), true);
  });

  it("accepts a valid 0x-hex signature", async () => {
    assert.equal(await verify("0x" + Buffer.from(sig).toString("hex")), true);
  });

  it("accepts a valid base64 signature", async () => {
    assert.equal(await verify(Buffer.from(sig).toString("base64")), true);
  });

  it("rejects a signature that doesn't validate for the address", async () => {
    const otherPriv = ed25519.utils.randomPrivateKey();
    const forged = ed25519.sign(messageBytes, otherPriv);
    assert.equal(await verify(bs58.encode(forged)), false);
  });

  it("returns null (unverified) for an undecodable signature", async () => {
    assert.equal(await verify("!!! not a signature !!!"), null);
  });
});
