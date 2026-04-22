import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    config = await import("#zerion/cli/lib/config.js");
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
