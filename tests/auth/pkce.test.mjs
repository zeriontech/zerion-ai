import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateSessionId,
  generateVerifier,
  generateChallenge,
} from "../../cli/lib/auth/pkce.js";

describe("pkce.generateSessionId", () => {
  it("returns 64 hex chars", () => {
    const id = generateSessionId();
    assert.equal(typeof id, "string");
    assert.equal(id.length, 64);
    assert.match(id, /^[0-9a-f]{64}$/);
  });

  it("returns different values on successive calls", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    assert.notEqual(a, b);
  });
});

describe("pkce.generateVerifier", () => {
  it("returns 43 base64url chars", () => {
    const v = generateVerifier();
    assert.equal(typeof v, "string");
    assert.equal(v.length, 43);
    // base64url alphabet: A-Z a-z 0-9 - _
    assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  });

  it("returns different values on successive calls", () => {
    const a = generateVerifier();
    const b = generateVerifier();
    assert.notEqual(a, b);
  });
});

describe("pkce.generateChallenge", () => {
  it("matches the known sha256 fixture for a fixed verifier", () => {
    const verifier = "test-verifier-zerion-cli-12345678901234";
    const challenge = generateChallenge(verifier);
    // Pre-computed: sha256(verifier) -> base64url
    assert.equal(challenge, "E0PhRBl4zAcNF3hl3T9j1XHzDXocYVN__AMSv6ZG-X0");
  });

  it("returns 43 base64url chars", () => {
    const challenge = generateChallenge(generateVerifier());
    assert.equal(challenge.length, 43);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  });

  it("produces different challenges for different verifiers", () => {
    const a = generateChallenge("verifier-a");
    const b = generateChallenge("verifier-b");
    assert.notEqual(a, b);
  });

  it("is deterministic for the same verifier", () => {
    const v = generateVerifier();
    assert.equal(generateChallenge(v), generateChallenge(v));
  });
});
