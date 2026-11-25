// `wallet list`, `delete`, `export-key`, `backup` and `set-review-threshold` on a Safe wallet, under a temp HOME.
// None of these commands reads a chain, and the fetch stub fails the test if one tries.

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Public Safes from the Safe transaction-service golden vectors: 1.4.1 on Base, and 1.3.0 on Ethereum.
const SAFE = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
const OTHER_SAFE = "0x87cc0d34f6111c8A7A4Bdf758a9a715A3675f941";
const HOT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const COLD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

let commands;
let registry;
let ows;
let readonly;
let tmpHome;
let requests;
const origHome = process.env.HOME;
const originalFetch = globalThis.fetch;

function chainCache(chainId, threshold, owners) {
  return { chainId, version: "1.4.1", threshold, owners, txService: null, appPrefix: null, refreshedAt: "2026-11-25T00:00:00.000Z" };
}

async function run(command, args, flags = {}) {
  let stdout = "";
  let stderr = "";
  const saved = { out: process.stdout.write, err: process.stderr.write, exit: process.exit };
  // The node:test reporter writes binary frames to stdout while a command awaits; only string writes are the command's.
  process.stdout.write = (chunk, ...rest) => {
    if (typeof chunk !== "string") return saved.out.call(process.stdout, chunk, ...rest);
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk, ...rest) => {
    if (typeof chunk !== "string") return saved.err.call(process.stderr, chunk, ...rest);
    stderr += chunk;
    return true;
  };
  process.exit = (code) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: code });
  };
  let code = 0;
  try {
    await command(args, flags);
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    code = err.exitCode;
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    process.exit = saved.exit;
  }
  const errorStart = stderr.indexOf("{");
  return {
    code,
    output: stdout ? JSON.parse(stdout) : null,
    error: errorStart === -1 ? null : JSON.parse(stderr.slice(errorStart)).error,
    stderr,
  };
}

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-safe-wallet-commands-"));
  process.env.HOME = tmpHome;
  commands = {
    list: (await import("#zerion/commands/wallet/list.js")).default,
    delete: (await import("#zerion/commands/wallet/delete.js")).default,
    exportKey: (await import("#zerion/commands/wallet/export-key.js")).default,
    backup: (await import("#zerion/commands/wallet/backup.js")).default,
    setReviewThreshold: (await import("#zerion/commands/wallet/set-review-threshold.js")).default,
  };
  registry = await import("#zerion/utils/safe/registry.js");
  ows = await import("#zerion/utils/wallet/keystore.js");
  readonly = await import("#zerion/utils/wallet/readonly.js");
  ows.createWallet("ks");
  readonly.addReadonly("hot", HOT);
  readonly.addReadonly("cold", COLD);
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error(`unexpected network call to ${url}`);
  };
  for (const s of registry.listSafes()) registry.removeSafe(s.name);
  registry.addSafe({
    name: "vault",
    address: SAFE,
    signers: ["hot", "cold"],
    executor: "ks",
    chains: { base: chainCache(8453, 2, [HOT, COLD]), ethereum: chainCache(1, 1, [HOT]) },
  });
  registry.addSafe({ name: "spare", address: OTHER_SAFE, signers: ["hot"] });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  assert.deepEqual(requests, []);
});

describe("Safe wallets in the wallet commands", () => {
  it("wallet list shows a Safe row with type safe and threshold/owners per cached chain, and --search finds it by address", async () => {
    const { code, output } = await run(commands.list, [], { search: SAFE.slice(0, 12).toLowerCase() });

    assert.equal(code, 0);
    assert.deepEqual(output.wallets, [{
      name: "vault",
      evmAddress: SAFE,
      type: "safe",
      signers: ["hot", "cold"],
      executor: "ks",
      chains: { base: "2/2", ethereum: "1/1" },
      policies: [],
      isDefault: false,
    }]);
  });

  it("wallet delete removes only the Safe entry, with no passphrase prompt", async () => {
    const { code, output } = await run(commands.delete, ["spare"]);

    assert.equal(code, 0);
    assert.deepEqual(output, { deleted: "spare", type: "safe" });
    assert.deepEqual(registry.listSafes().map((s) => s.name), ["vault"]);
    assert.deepEqual(ows.listWallets().map((w) => w.name), ["ks"]);
    assert.deepEqual(readonly.listReadonly().map((w) => w.name), ["hot", "cold"]);
  });

  it("wallet export-key refuses a Safe with safe_no_keys", async () => {
    const { code, error } = await run(commands.exportKey, ["vault"]);

    assert.equal(code, 1);
    assert.equal(error.code, "safe_no_keys");
  });

  it("wallet backup refuses a Safe with safe_no_keys", async () => {
    const { code, error } = await run(commands.backup, ["vault"]);

    assert.equal(code, 1);
    assert.equal(error.code, "safe_no_keys");
  });

  it("wallet set-review-threshold accepts a Safe, and wallet list decorates its row", async () => {
    const { code, output } = await run(commands.setReviewThreshold, ["vault", "5"]);

    assert.equal(code, 0);
    assert.equal(output.reviewThresholdUsd, 5);
    const listed = await run(commands.list, [], { search: "vault" });
    assert.equal(listed.output.wallets[0].reviewThresholdUsd, 5);
  });
});
