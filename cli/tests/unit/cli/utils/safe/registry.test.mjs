// Safe registry: round-trip, file mode, missing/corrupt file, upsert and removal, under a temp HOME.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let registry;
let tmpHome;
let safePath;
const origHome = process.env.HOME;

// Public Safe 1.4.1 on Base from the Safe transaction-service golden vectors.
const SAFE_LOWER = "0xd2e580a552cb7a6b87e45ede8f0102698c476d7f";
const SAFE_CHECKSUMMED = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";

const baseCache = {
  chainId: 8453,
  version: "1.4.1",
  threshold: 2,
  owners: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
  txService: "https://api.safe.global/tx-service/base",
  appPrefix: "base",
  refreshedAt: "2026-11-25T00:00:00.000Z",
};

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-"));
  process.env.HOME = tmpHome;
  safePath = join(tmpHome, ".zerion", "safe-wallets.json");
  registry = await import("#zerion/utils/safe/registry.js");
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(safePath, { force: true });
});

describe("Safe registry", () => {
  it("treats a missing file as empty", () => {
    assert.equal(existsSync(safePath), false);
    assert.deepEqual(registry.listSafes(), []);
    assert.equal(registry.getSafe("treasury"), null);
    assert.equal(registry.isSafeWallet("treasury"), false);
  });

  it("treats a corrupt file as empty", () => {
    registry.addSafe({ name: "treasury", address: SAFE_LOWER, signers: ["hot"] });
    writeFileSync(safePath, "{not json");
    assert.deepEqual(registry.listSafes(), []);
    writeFileSync(safePath, JSON.stringify({ name: "not-an-array" }));
    assert.deepEqual(registry.listSafes(), []);
  });

  it("round-trips a SafeEntry with a checksummed address, written with mode 0600", () => {
    registry.addSafe({
      name: "treasury",
      address: SAFE_LOWER,
      signers: ["hot", "cold"],
      executor: "hot",
      chains: { base: baseCache },
    });

    assert.equal(statSync(safePath).mode & 0o777, 0o600);
    const entry = registry.getSafe("treasury");
    assert.equal(entry.name, "treasury");
    assert.equal(entry.address, SAFE_CHECKSUMMED);
    assert.deepEqual(entry.signers, ["hot", "cold"]);
    assert.equal(entry.executor, "hot");
    assert.deepEqual(entry.chains, { base: baseCache });
    assert.match(entry.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(entry.updatedAt, undefined);
    assert.equal(registry.isSafeWallet("treasury"), true);
    assert.deepEqual(registry.listSafes(), [entry]);
  });

  it("defaults executor to null and upserts by name, keeping createdAt", () => {
    registry.addSafe({ name: "treasury", address: SAFE_LOWER, signers: ["hot"] });
    const first = registry.getSafe("treasury");
    assert.equal(first.executor, null);

    registry.addSafe({ name: "treasury", address: SAFE_LOWER, signers: ["cold"], chains: { base: baseCache } });
    const updated = registry.getSafe("treasury");
    assert.equal(registry.listSafes().length, 1);
    assert.deepEqual(updated.signers, ["cold"]);
    assert.deepEqual(updated.chains, { base: baseCache });
    assert.equal(updated.createdAt, first.createdAt);
    assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a bad address and an empty signer list", () => {
    assert.throws(() => registry.addSafe({ name: "x", address: "0x1234", signers: ["hot"] }), /0x EVM address/);
    assert.throws(() => registry.addSafe({ name: "x", address: SAFE_LOWER, signers: [] }), /at least one signer/);
    assert.deepEqual(registry.listSafes(), []);
  });

  it("removes a Safe, and throws when removing an unknown name", () => {
    registry.addSafe({ name: "treasury", address: SAFE_LOWER, signers: ["hot"] });
    registry.removeSafe("treasury");
    assert.equal(registry.getSafe("treasury"), null);
    assert.throws(() => registry.removeSafe("ghost"), { message: '"ghost" is not a Safe wallet' });
  });
});
