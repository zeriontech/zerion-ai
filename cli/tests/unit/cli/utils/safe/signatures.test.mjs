import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  normalizeOwnerSignature,
  recoverSafeSigner,
  preApprovedSignature,
  encodeSignatures,
} from "#zerion/utils/safe/signatures.js";

const FIXTURES_DIR = new URL("../../../../fixtures/safe/", import.meta.url);

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), "utf8"));
}

const BASE = loadFixture("base-1.4.1-op0.json");
const OTHER = loadFixture("ethereum-1.3.0-op0.json");

const OWNERS = [1, 2, 3].map((n) => privateKeyToAccount(keccak256(toHex(`zerion-safe-test-owner-${n}`))));

const DOCUMENTED_V = {
  typed: new Map([[0, 27], [1, 28], [27, 27], [28, 28]]),
  hash: new Map([[0, 31], [1, 32], [27, 31], [28, 32], [31, 31], [32, 32]]),
};

const RS = `0x${"11".repeat(32)}${"22".repeat(32)}`;

function vByte(v) {
  return v.toString(16).padStart(2, "0");
}

function vOf(signature) {
  return parseInt(signature.slice(-2), 16);
}

function isMalformed(err) {
  return err.code === "safe_signature_malformed";
}

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

describe("normalizeOwnerSignature", () => {
  for (const mode of ["typed", "hash"]) {
    it(`${mode}: every v in 0..255 maps to the documented Safe v or throws safe_signature_malformed`, () => {
      const mapping = DOCUMENTED_V[mode];
      for (let v = 0; v <= 255; v++) {
        const signature = `${RS}${vByte(v)}`;
        if (mapping.has(v)) {
          assert.equal(normalizeOwnerSignature({ signature, mode }), `${RS}${vByte(mapping.get(v))}`, `v=${v}`);
        } else {
          assert.throws(() => normalizeOwnerSignature({ signature, mode }), isMalformed, `v=${v}`);
        }
      }
    });
  }

  it("rejects 64- and 66-byte inputs", () => {
    for (const mode of ["typed", "hash"]) {
      for (const signature of [RS, `${RS}1b1b`]) {
        assert.throws(() => normalizeOwnerSignature({ signature, mode }), isMalformed);
      }
    }
  });

  it("rejects an unknown mode", () => {
    assert.throws(() => normalizeOwnerSignature({ signature: `${RS}1b`, mode: "personal" }), isMalformed);
  });
});

describe("recoverSafeSigner", () => {
  for (const [index, owner] of OWNERS.entries()) {
    it(`test owner ${index + 1}: typed (27/28) signature over the base fixture recovers to the owner`, async () => {
      const raw = await owner.signTypedData(BASE.typedData);
      const signature = normalizeOwnerSignature({ signature: raw, mode: "typed" });
      assert.ok([27, 28].includes(vOf(signature)));
      assert.equal(await recoverSafeSigner({ signature, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }), owner.address);

      const yParityForm = `${raw.slice(0, -2)}${vByte(vOf(raw) - 27)}`;
      const fromYParity = normalizeOwnerSignature({ signature: yParityForm, mode: "typed" });
      assert.equal(await recoverSafeSigner({ signature: fromYParity, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }), owner.address);
    });

    it(`test owner ${index + 1}: eth_sign (31/32) signature over the base safeTxHash recovers to the owner`, async () => {
      const raw = await owner.signMessage({ message: { raw: BASE.safeTxHash } });
      const signature = normalizeOwnerSignature({ signature: raw, mode: "hash" });
      assert.ok([31, 32].includes(vOf(signature)));
      assert.equal(await recoverSafeSigner({ signature, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }), owner.address);
    });

    it(`test owner ${index + 1}: pre-approved (v=1) signature recovers to the owner`, async () => {
      const signature = preApprovedSignature(owner.address.toLowerCase());
      assert.equal(signature, `0x${"00".repeat(12)}${owner.address.slice(2).toLowerCase()}${"00".repeat(32)}01`);
      assert.equal(await recoverSafeSigner({ signature, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }), owner.address);
    });

    it(`test owner ${index + 1}: a signature over a different fixture recovers to a different address`, async () => {
      const typed = normalizeOwnerSignature({ signature: await owner.signTypedData(OTHER.typedData), mode: "typed" });
      const hash = normalizeOwnerSignature({ signature: await owner.signMessage({ message: { raw: OTHER.safeTxHash } }), mode: "hash" });
      for (const signature of [typed, hash]) {
        const recovered = await recoverSafeSigner({ signature, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash });
        assert.notEqual(recovered, owner.address);
      }
    });
  }

  it("throws safe_signature_malformed for a v outside 1, 27, 28, 31, 32", async () => {
    for (const v of [0, 2, 29, 30, 33]) {
      await assert.rejects(
        recoverSafeSigner({ signature: `${RS}${vByte(v)}`, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }),
        isMalformed
      );
    }
  });
});

describe("encodeSignatures", () => {
  it("orders by owner address ascending for all 6 input permutations", async () => {
    const entries = await Promise.all(
      OWNERS.map(async (owner) => ({
        owner: owner.address,
        signature: normalizeOwnerSignature({ signature: await owner.signTypedData(BASE.typedData), mode: "typed" }),
      }))
    );
    const blobs = new Set(permutations(entries).map((order) => encodeSignatures(order)));
    assert.equal(blobs.size, 1);

    const [blob] = blobs;
    assert.equal(blob.length, 2 + 3 * 130);
    const signers = [];
    for (let i = 0; i < 3; i++) {
      const signature = `0x${blob.slice(2 + i * 130, 2 + (i + 1) * 130)}`;
      signers.push(await recoverSafeSigner({ signature, typedData: BASE.typedData, safeTxHash: BASE.safeTxHash }));
    }
    assert.deepEqual(new Set(signers), new Set(OWNERS.map((owner) => owner.address)));
    for (let i = 1; i < signers.length; i++) {
      assert.ok(BigInt(signers[i - 1]) < BigInt(signers[i]), `${signers[i - 1]} must sort before ${signers[i]}`);
    }
  });

  it("rejects a duplicate owner regardless of address case", () => {
    const owner = OWNERS[0].address;
    assert.throws(
      () =>
        encodeSignatures([
          { owner, signature: preApprovedSignature(owner) },
          { owner: owner.toLowerCase(), signature: preApprovedSignature(owner) },
        ]),
      (err) => err.code === "safe_signature_duplicate_owner"
    );
  });
});
