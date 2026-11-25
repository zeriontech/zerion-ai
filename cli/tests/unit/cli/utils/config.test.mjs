import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Override config paths for testing
const testDir = join(tmpdir(), `zerion-test-${Date.now()}`);

// We need to set env vars before importing config module
process.env.HOME = tmpdir();

describe("config", () => {
  let config;

  beforeEach(async () => {
    // Clean up any existing config from prior tests
    if (existsSync(join(tmpdir(), ".zerion"))) {
      rmSync(join(tmpdir(), ".zerion"), { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    // Fresh import each time
    config = await import("#zerion/utils/config.js");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("loadConfig returns defaults when no file exists", () => {
    const cfg = config.loadConfig();
    assert.equal(cfg.slippage, 2);
    assert.equal(cfg.defaultChain, "ethereum");
    assert.equal(cfg.apiKey, null);
    assert.equal(cfg.defaultWallet, null);
  });

  it("setConfigValue and getConfigValue round-trip", () => {
    config.setConfigValue("defaultWallet", "test-wallet");
    assert.equal(config.getConfigValue("defaultWallet"), "test-wallet");
  });

  it("setConfigValue preserves other values", () => {
    config.setConfigValue("apiKey", "zk_dev_abc");
    config.setConfigValue("slippage", 1.5);
    assert.equal(config.getConfigValue("apiKey"), "zk_dev_abc");
    assert.equal(config.getConfigValue("slippage"), 1.5);
  });
});

describe("zerion config safeApiKey", () => {
  const ZERION_BIN = fileURLToPath(new URL("../../../../zerion.js", import.meta.url));
  const SAFE_KEY = "fake-safe-key-1234567890abcdef";
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "zerion-config-safe-"));
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function runZerion(args) {
    const env = { ...process.env, HOME: home };
    delete env.SAFE_API_KEY;
    return spawnSync(process.execPath, [ZERION_BIN, ...args], { encoding: "utf8", env });
  }

  it("config set safeApiKey succeeds and config list masks it", () => {
    const set = runZerion(["config", "set", "safeApiKey", SAFE_KEY]);
    assert.equal(set.status, 0, set.stderr);
    assert.deepEqual(JSON.parse(set.stdout), { safeApiKey: "fake-saf...", updated: true });

    const list = runZerion(["config", "list"]);
    assert.equal(list.status, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).config.safeApiKey, "fake-saf...");
    assert.ok(!list.stdout.includes(SAFE_KEY));
    assert.ok(!list.stderr.includes(SAFE_KEY));

    const stored = JSON.parse(readFileSync(join(home, ".zerion", "config.json"), "utf8"));
    assert.equal(stored.safeApiKey, SAFE_KEY);
  });
});
