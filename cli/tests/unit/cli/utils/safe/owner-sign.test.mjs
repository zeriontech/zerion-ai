import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = JSON.parse(readFileSync(new URL("../../../../fixtures/safe/base-1.4.1-op0.json", import.meta.url), "utf8"));
const OWNER = privateKeyToAccount(keccak256(toHex("zerion-safe-test-owner-1")));
const SIGNER = { walletName: "owner-1", address: OWNER.address, readOnly: false };
const AGENT_TOKEN = "ows_key_owner_sign_unit_test";

let signSafeTxAsOwner;
let __setKeystoreForTests;
let tmpHome;
let ownerTypedSignature;
const origHome = process.env.HOME;
const origEnvToken = process.env.ZERION_AGENT_TOKEN;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-owner-sign-"));
  process.env.HOME = tmpHome;
  process.env.ZERION_AGENT_TOKEN = AGENT_TOKEN;
  ({ signSafeTxAsOwner, __setKeystoreForTests } = await import("#zerion/utils/safe/owner-sign.js"));
  ownerTypedSignature = await OWNER.signTypedData(BASE.typedData);
});

afterEach(() => {
  __setKeystoreForTests(null);
});

after(() => {
  process.env.HOME = origHome;
  if (origEnvToken === undefined) delete process.env.ZERION_AGENT_TOKEN;
  else process.env.ZERION_AGENT_TOKEN = origEnvToken;
  rmSync(tmpHome, { recursive: true, force: true });
});

function throwingKeystore() {
  const calls = [];
  return {
    calls,
    signTypedData: (...args) => {
      calls.push(args);
      throw new Error("keystore must not be unlocked");
    },
  };
}

function signingKeystore(format) {
  const calls = [];
  return {
    calls,
    signTypedData: (...args) => {
      calls.push(args);
      return { signature: format(ownerTypedSignature), recoveryId: parseInt(ownerTypedSignature.slice(-2), 16) };
    },
  };
}

describe("signSafeTxAsOwner (local route)", () => {
  it("refuses --sign-mode hash with sign_mode_requires_review before any keystore unlock", async () => {
    const keystore = throwingKeystore();
    __setKeystoreForTests(keystore);
    await assert.rejects(
      signSafeTxAsOwner({
        typedData: BASE.typedData,
        safeTxHash: BASE.safeTxHash,
        chainIdNum: 8453,
        signer: SIGNER,
        route: "local",
        signMode: "hash",
      }),
      (err) => err.code === "sign_mode_requires_review" && /--review/.test(err.suggestion)
    );
    assert.equal(keystore.calls.length, 0);
  });

  it("refuses a safeTxHash the typed data does not hash to, before any keystore unlock", async () => {
    const keystore = throwingKeystore();
    __setKeystoreForTests(keystore);
    await assert.rejects(
      signSafeTxAsOwner({
        typedData: BASE.typedData,
        safeTxHash: `0x${"00".repeat(32)}`,
        chainIdNum: 8453,
        signer: SIGNER,
        route: "local",
      }),
      (err) => err.code === "safe_hash_mismatch"
    );
    assert.equal(keystore.calls.length, 0);
  });

  for (const [form, format] of [
    ["unprefixed (as OWS returns it)", (sig) => sig.slice(2)],
    ["0x-prefixed", (sig) => sig],
  ]) {
    it(`signs typed data with the owner's agent token and returns a Safe-form signature: ${form}`, async () => {
      const keystore = signingKeystore(format);
      __setKeystoreForTests(keystore);
      const result = await signSafeTxAsOwner({
        typedData: BASE.typedData,
        safeTxHash: BASE.safeTxHash,
        chainIdNum: 8453,
        signer: SIGNER,
        route: "local",
      });

      assert.equal(keystore.calls.length, 1);
      const [walletName, typedDataJson, passphrase, caip2] = keystore.calls[0];
      assert.equal(walletName, "owner-1");
      assert.deepEqual(JSON.parse(typedDataJson), BASE.typedData);
      assert.equal(passphrase, AGENT_TOKEN);
      assert.equal(caip2, "eip155:8453");

      assert.equal(result.owner, OWNER.address);
      assert.equal(result.signMode, "typed");
      assert.equal(result.signedVia, "local");
      assert.match(result.signature, /^0x[0-9a-f]{128}(1b|1c)$/);
      assert.equal(await recoverTypedDataAddress({ ...BASE.typedData, signature: result.signature }), OWNER.address);
    });
  }
});
