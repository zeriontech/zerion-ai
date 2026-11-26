// Token and policy resolution follow the wallet that signs, not the default
// wallet. Before this, `--wallet <non-default>` unlocked the keystore with the
// default wallet's agent token (OWS rejects it: "API key … does not have access
// to wallet") and ran the default wallet's policies against another wallet's
// transaction.
//
// Uses a temp HOME so neither ~/.zerion nor ~/.ows is touched (CONFIG_DIR is
// derived from HOME at import time, so HOME must be set before the imports).

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeTransaction } from "viem";

const POLICIES_DIR = dirname(fileURLToPath(import.meta.resolve("#zerion/policies/allowlist.mjs")));
const ALLOWED_A = "0x00000000000000000000000000000000000000a1";
const ALLOWED_B = "0x00000000000000000000000000000000000000b2";
const ALLOWED_C = "0x00000000000000000000000000000000000000c3";

let ows;
let config;
let guards;
let tmpHome;
let tokenA;
let tokenB;
let idB;
const origHome = process.env.HOME;
const origEnvToken = process.env.ZERION_AGENT_TOKEN;

// An executable policy that only allows transactions to `allowed`.
function allowlistPolicy(id, allowed, rules = []) {
  ows.createPolicy(id, id, rules, join(POLICIES_DIR, "run-policies.mjs"), {
    scripts: [join(POLICIES_DIR, "allowlist.mjs")],
    allowed_addresses: [allowed],
  });
  return id;
}

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-guards-"));
  process.env.HOME = tmpHome;
  delete process.env.ZERION_AGENT_TOKEN;
  ows = await import("#zerion/utils/wallet/keystore.js");
  config = await import("#zerion/utils/config.js");
  guards = await import("#zerion/utils/trading/guards.js");

  // "g-a" is the default wallet. "g-a" and "g-b" each have their own token and
  // their own policy; "g-c" has no token at all. "g-d" has two live tokens with
  // different policies, so every one of them must be enforced.
  ows.createWallet("g-a", "pass-a");
  idB = ows.createWallet("g-b", "pass-b").id;
  ows.createWallet("g-c", "pass-c");
  ows.createWallet("g-d", "pass-d");
  tokenA = ows.createAgentToken("tok-a", "g-a", "pass-a", undefined, [allowlistPolicy("only-a1", ALLOWED_A)]).token;
  tokenB = ows.createAgentToken("tok-b", "g-b", "pass-b", undefined, [allowlistPolicy("only-b2", ALLOWED_B)]).token;
  ows.createAgentToken("tok-d1", "g-d", "pass-d", undefined, [allowlistPolicy("only-d1", ALLOWED_A)]);
  ows.createAgentToken("tok-d2", "g-d", "pass-d", undefined, [allowlistPolicy("only-d2", ALLOWED_C)]);
  // One key that covers two wallets, as `ows key create --wallet g-e --wallet g-f`
  // makes. Its policy applies to both wallets, not only to the first one.
  const idE = ows.createWallet("g-e", "pass-ef").id;
  const idF = ows.createWallet("g-f", "pass-ef").id;
  const core = await import("@open-wallet-standard/core");
  core.createApiKey("tok-ef", [idE, idF], [allowlistPolicy("only-ef", ALLOWED_A)], "pass-ef");
  config.saveAgentToken("g-a", tokenA);
  config.saveAgentToken("g-b", tokenB);
  config.setConfigValue("defaultWallet", "g-a");
});

after(() => {
  process.env.HOME = origHome;
  if (origEnvToken === undefined) delete process.env.ZERION_AGENT_TOKEN;
  else process.env.ZERION_AGENT_TOKEN = origEnvToken;
  rmSync(tmpHome, { recursive: true, force: true });
});

class Exited extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

// The guards report failure with printError + process.exit rather than by
// throwing, so intercept both to assert on the structured error. Only the
// first error counts: a stubbed exit throws where the real one would stop the
// process, so code after it may report again.
async function runExpectingExit(fn) {
  const origExit = process.exit;
  const origWrite = process.stderr.write;
  const origIsTTY = process.stderr.isTTY;
  const writes = [];
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  process.exit = (code) => { throw new Exited(code); };
  process.stderr.isTTY = false;
  try {
    await fn();
    return { exited: false };
  } catch (err) {
    if (!(err instanceof Exited)) throw err;
    return { exited: true, code: err.code, error: JSON.parse(writes[0]).error };
  } finally {
    process.exit = origExit;
    process.stderr.write = origWrite;
    process.stderr.isTTY = origIsTTY;
  }
}

describe("getAgentToken", () => {
  it("accepts the wallet's id as well as its name, as --wallet does", () => {
    assert.equal(ows.getAgentToken(idB), tokenB);
  });

  it("returns the default wallet's token when no wallet is named", () => {
    assert.equal(ows.getAgentToken(), tokenA);
  });

  it("lets an explicit ZERION_AGENT_TOKEN win", () => {
    process.env.ZERION_AGENT_TOKEN = "env-token";
    try {
      assert.equal(ows.getAgentToken("g-b"), "env-token");
    } finally {
      delete process.env.ZERION_AGENT_TOKEN;
    }
  });
});

describe("requireAgentToken", () => {
  it("returns the signing wallet's token, which is the one OWS accepts for it", async () => {
    const token = await guards.requireAgentToken("for trading", "g-b");
    assert.equal(token, tokenB);

    const unsigned = serializeTransaction({
      type: "eip1559", chainId: 1, nonce: 0, to: ALLOWED_B, value: 0n,
      gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n,
    });
    assert.ok(ows.signEvmTransaction("g-b", unsigned, token, "eip155:1").signature);
    // The default wallet's token — what used to be returned — cannot sign for g-b.
    assert.throws(
      () => ows.signEvmTransaction("g-b", unsigned, tokenA, "eip155:1"),
      /does not have access to wallet/,
    );
  });

  it("exits no_agent_token naming the wallet when it has none, instead of borrowing the default's", async () => {
    const result = await runExpectingExit(() => guards.requireAgentToken("for trading", "g-c"));
    assert.equal(result.exited, true);
    assert.equal(result.code, 1);
    assert.equal(result.error.code, "no_agent_token");
    assert.match(result.error.message, /wallet "g-c" has none/);
    assert.match(result.error.suggestion, /--wallet g-c/);
  });
});

describe("enforceExecutablePolicies", () => {
  const tx = (to, walletName) => ({ to, value: "0", data: "0x", chain: "ethereum", walletName });

  it("applies the signing wallet's policy, not the default wallet's", async () => {
    // ALLOWED_B is outside the default wallet's allowlist but inside g-b's.
    const allowed = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_B, "g-b")));
    assert.equal(allowed.exited, false);

    // ALLOWED_A is inside the default wallet's allowlist but outside g-b's.
    const denied = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_A, "g-b")));
    assert.equal(denied.exited, true);
    assert.equal(denied.error.code, "policy_denied");
    assert.equal(denied.error.policy, "only-b2");
  });

  it("enforces every live token's policy for the signing wallet (fail-closed)", async () => {
    // g-d has two live keys: one allows A, the other allows C. Each policy must
    // run, so a transaction allowed by only one of them is still denied.
    const deniedBySecond = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_A, "g-d")));
    assert.equal(deniedBySecond.exited, true);
    assert.equal(deniedBySecond.error.policy, "only-d2");

    const deniedByFirst = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_C, "g-d")));
    assert.equal(deniedByFirst.exited, true);
    assert.equal(deniedByFirst.error.policy, "only-d1");
  });

  it("enforces a key's policy for every wallet the key covers, not only the first", async () => {
    for (const wallet of ["g-e", "g-f"]) {
      const denied = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_B, wallet)));
      assert.equal(denied.exited, true, wallet);
      assert.equal(denied.error.policy, "only-ef", wallet);
    }
  });

  it("finds the wallet's policy when the wallet is named by its id", async () => {
    const denied = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_A, idB)));
    assert.equal(denied.exited, true);
    assert.equal(denied.error.policy, "only-b2");
  });

  it("refuses to guess a wallet: the signer must be named", async () => {
    await assert.rejects(() => guards.enforceExecutablePolicies(tx(ALLOWED_A)), /walletName is required/);
  });

  describe("skips the policies of a key OWS would refuse to sign with", () => {
    // Each wallet has a live baseline key allowing only ALLOWED_B and a case key allowing only ALLOWED_A.
    // A transaction to ALLOWED_B is denied exactly when the case key's script ran; one to ALLOWED_A is
    // denied by the baseline script, which always runs.
    const PAST = "2026-11-19T00:00:00Z";
    const FUTURE = "2099-01-01T00:00:00Z";
    const expiresAt = (timestamp) => [{ type: "expires_at", timestamp }];
    const cases = [
      { name: "a key past its own expiresAt", keyExpires: PAST, ran: false },
      { name: "a key whose allowlist policy has a past expires_at rule", rules: expiresAt(PAST), ran: false },
      { name: "a key with a second, rule-only policy whose expires_at is past", sibling: expiresAt(PAST), ran: false },
      { name: "a revoked key", revoke: true, ran: false },
      { name: "a key and a policy that both expire in the future", keyExpires: FUTURE, rules: expiresAt(FUTURE), ran: true },
      { name: "a key and a policy with no expiry", ran: true },
    ];

    cases.forEach(({ name, keyExpires, rules = [], sibling, revoke, ran }, i) => {
      it(`${ran ? "runs" : "skips"} ${name}`, async () => {
        const wallet = `g-exp-${i}`;
        const caseId = `exp-case-${i}`;
        const baseId = `exp-base-${i}`;
        ows.createWallet(wallet, "pass-exp");
        ows.createAgentToken(`tok-base-${i}`, wallet, "pass-exp", undefined, [allowlistPolicy(baseId, ALLOWED_B)]);
        const policyIds = [allowlistPolicy(caseId, ALLOWED_A, rules)];
        if (sibling) {
          ows.createPolicy(`exp-sibling-${i}`, `exp-sibling-${i}`, sibling, null, null);
          policyIds.push(`exp-sibling-${i}`);
        }
        const { id } = ows.createAgentToken(`tok-case-${i}`, wallet, "pass-exp", keyExpires, policyIds);
        if (revoke) ows.revokeAgentToken(id);

        const toB = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_B, wallet)));
        assert.equal(toB.exited, ran);
        if (ran) assert.equal(toB.error.policy, caseId);

        const toA = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_A, wallet)));
        assert.equal(toA.exited, true);
        assert.equal(toA.error.policy, baseId);
      });
    });
  });

  it("enforces nothing for a wallet with no agent token, or one outside the keystore", async () => {
    for (const wallet of ["g-c", "a-read-only-wallet"]) {
      const result = await runExpectingExit(() => guards.enforceExecutablePolicies(tx(ALLOWED_B, wallet)));
      assert.equal(result.exited, false, wallet);
    }
  });
});
