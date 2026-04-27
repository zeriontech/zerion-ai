import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuth, resolveApiKeyAuth, basicAuthHeader } from "#zerion/utils/api/auth.js";

// Synthetic keys that pass the format detectors but are never used for
// actual crypto operations — resolveAuth is pure and doesn't touch the network.
const EVM_KEY = "0x" + "a".repeat(64);
const SOL_KEY = "5".repeat(88); // base58 alphabet, ≥87 chars

function call(flags, env) {
  return resolveAuth(flags, env);
}

function expectError(flags, env, code) {
  try {
    resolveAuth(flags, env);
    assert.fail(`expected error with code ${code}, got success`);
  } catch (err) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  }
}

describe("resolveAuth — mutual exclusion", () => {
  it("rejects both --x402 and --mpp flags", () => {
    expectError({ x402: true, mpp: true }, {}, "mutually_exclusive_auth");
  });

  it("rejects flag plus opposite env var", () => {
    expectError({ x402: true }, { ZERION_MPP: "true" }, "mutually_exclusive_auth");
    expectError({ mpp: true }, { ZERION_X402: "true" }, "mutually_exclusive_auth");
  });

  it("rejects both env vars set together", () => {
    expectError({}, { ZERION_X402: "true", ZERION_MPP: "true" }, "mutually_exclusive_auth");
  });
});

describe("resolveAuth — MPP mode", () => {
  it("resolves TEMPO_PRIVATE_KEY", () => {
    const a = call({ mpp: true }, { TEMPO_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.kind, "mpp");
    assert.equal(a.key, EVM_KEY);
  });

  it("falls back to WALLET_PRIVATE_KEY", () => {
    const a = call({ mpp: true }, { WALLET_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.kind, "mpp");
    assert.equal(a.key, EVM_KEY);
  });

  it("TEMPO_PRIVATE_KEY wins over WALLET_PRIVATE_KEY", () => {
    const tempo = "0x" + "b".repeat(64);
    const a = call({ mpp: true }, { TEMPO_PRIVATE_KEY: tempo, WALLET_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.key, tempo);
  });

  it("ZERION_MPP=true activates without --mpp flag", () => {
    const a = call({}, { ZERION_MPP: "true", WALLET_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.kind, "mpp");
  });

  it("rejects missing key", () => {
    expectError({ mpp: true }, {}, "missing_mpp_key");
  });

  it("rejects Solana-looking key (base58 ≥87 chars)", () => {
    expectError({ mpp: true }, { WALLET_PRIVATE_KEY: SOL_KEY }, "invalid_mpp_key");
  });

  it("rejects non-0x random string", () => {
    expectError({ mpp: true }, { TEMPO_PRIVATE_KEY: "not-a-hex-key" }, "invalid_mpp_key");
  });
});

describe("resolveAuth — x402 mode", () => {
  it("detects 0x WALLET_PRIVATE_KEY as EVM", () => {
    const a = call({ x402: true }, { WALLET_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.kind, "x402");
    assert.equal(a.keys.evm, EVM_KEY);
    assert.equal(a.keys.solana, "");
  });

  it("detects base58 WALLET_PRIVATE_KEY (≥87 chars) as Solana", () => {
    const a = call({ x402: true }, { WALLET_PRIVATE_KEY: SOL_KEY });
    assert.equal(a.keys.evm, "");
    assert.equal(a.keys.solana, SOL_KEY);
  });

  it("rejects short base58 string as neither EVM nor Solana", () => {
    expectError({ x402: true }, { WALLET_PRIVATE_KEY: "5".repeat(40) }, "missing_x402_key");
  });

  it("rejects non-base58 non-0x string", () => {
    expectError({ x402: true }, { WALLET_PRIVATE_KEY: "not-a-real-key!" }, "missing_x402_key");
  });

  it("EVM_PRIVATE_KEY overrides WALLET_PRIVATE_KEY for EVM slot", () => {
    const override = "0x" + "c".repeat(64);
    const a = call({ x402: true }, { WALLET_PRIVATE_KEY: EVM_KEY, EVM_PRIVATE_KEY: override });
    assert.equal(a.keys.evm, override);
  });

  it("SOLANA_PRIVATE_KEY overrides WALLET_PRIVATE_KEY for Solana slot", () => {
    const a = call({ x402: true }, { WALLET_PRIVATE_KEY: EVM_KEY, SOLANA_PRIVATE_KEY: SOL_KEY });
    assert.equal(a.keys.evm, EVM_KEY);
    assert.equal(a.keys.solana, SOL_KEY);
  });

  it("populates both slots when both dedicated keys set", () => {
    const a = call({ x402: true }, { EVM_PRIVATE_KEY: EVM_KEY, SOLANA_PRIVATE_KEY: SOL_KEY });
    assert.equal(a.keys.evm, EVM_KEY);
    assert.equal(a.keys.solana, SOL_KEY);
  });

  it("preferSolana=true only when ZERION_X402_PREFER_SOLANA is literal 'true'", () => {
    const base = { WALLET_PRIVATE_KEY: EVM_KEY };
    assert.equal(call({ x402: true }, { ...base }).preferSolana, false);
    assert.equal(call({ x402: true }, { ...base, ZERION_X402_PREFER_SOLANA: "true" }).preferSolana, true);
    assert.equal(call({ x402: true }, { ...base, ZERION_X402_PREFER_SOLANA: "1" }).preferSolana, false);
    assert.equal(call({ x402: true }, { ...base, ZERION_X402_PREFER_SOLANA: "yes" }).preferSolana, false);
  });

  it("ZERION_X402=true activates without --x402 flag", () => {
    const a = call({}, { ZERION_X402: "true", WALLET_PRIVATE_KEY: EVM_KEY });
    assert.equal(a.kind, "x402");
  });

  it("rejects when no key set", () => {
    expectError({ x402: true }, {}, "missing_x402_key");
  });
});

describe("resolveAuth — apiKey fallback", () => {
  // The apiKey branch calls getApiKey() which reads process.env.ZERION_API_KEY
  // (and, failing that, the user's config file). Stub process.env here to
  // isolate from the developer's real key; the config file lookup is left alone.
  function withEnvKey(value, fn) {
    const prev = process.env.ZERION_API_KEY;
    if (value === undefined) delete process.env.ZERION_API_KEY;
    else process.env.ZERION_API_KEY = value;
    try { fn(); } finally {
      if (prev === undefined) delete process.env.ZERION_API_KEY;
      else process.env.ZERION_API_KEY = prev;
    }
  }

  it("returns apiKey kind when ZERION_API_KEY is set and no pay-per-call flags", () => {
    withEnvKey("zk_dev_test_fake", () => {
      const a = call({}, {});
      assert.equal(a.kind, "apiKey");
      assert.equal(a.key, "zk_dev_test_fake");
    });
  });
});

describe("resolveApiKeyAuth (fetchAPI fallback for trading commands)", () => {
  // This helper is used by fetchAPI when callers don't pass auth explicitly
  // (e.g., trading commands). It must IGNORE ZERION_X402 / ZERION_MPP to
  // avoid silently opting trading flows into pay-per-call via a globally
  // set env var.
  function withEnv(patch, fn) {
    const saved = {};
    for (const k of Object.keys(patch)) {
      saved[k] = process.env[k];
      if (patch[k] === undefined) delete process.env[k];
      else process.env[k] = patch[k];
    }
    try { fn(); } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("returns apiKey when ZERION_API_KEY is set", () => {
    withEnv({ ZERION_API_KEY: "zk_dev_test" }, () => {
      const a = resolveApiKeyAuth();
      assert.equal(a.kind, "apiKey");
      assert.equal(a.key, "zk_dev_test");
    });
  });

  it("ignores ZERION_X402=true (trading must not auto-opt into pay-per-call)", () => {
    withEnv({ ZERION_API_KEY: "zk_dev_test", ZERION_X402: "true" }, () => {
      const a = resolveApiKeyAuth();
      assert.equal(a.kind, "apiKey");
    });
  });

  it("ignores ZERION_MPP=true (trading must not auto-opt into pay-per-call)", () => {
    withEnv({ ZERION_API_KEY: "zk_dev_test", ZERION_MPP: "true" }, () => {
      const a = resolveApiKeyAuth();
      assert.equal(a.kind, "apiKey");
    });
  });
});

describe("basicAuthHeader", () => {
  it("produces correct Base64 for a normal key", () => {
    const header = basicAuthHeader("zk_dev_abc");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "zk_dev_abc:");
  });

  it("produces correct header for empty string", () => {
    const header = basicAuthHeader("");
    assert.equal(header, "Basic Og==");
    const decoded = Buffer.from("Og==", "base64").toString();
    assert.equal(decoded, ":");
  });

  it("handles special characters in key", () => {
    const header = basicAuthHeader("key+with/special=chars");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "key+with/special=chars:");
  });
});
