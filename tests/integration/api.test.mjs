import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getApiKey } from "#zerion/lib/config.js";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));

const API_KEY = getApiKey() || "";
const SKIP = !API_KEY;
const SKIP_MSG = "Skipping: no API key found (set ZERION_API_KEY or run `zerion config set apiKey <key>`)";

const VITALIK = "0x42b9dF65B219B3dD36FF330A4dD8f327A6Ada990";

function run(args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...process.env }, timeout: 30000 },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
          json: (() => { try { return JSON.parse(stdout); } catch { return null; } })()
        });
      }
    );
  });
}

describe("integration tests (requires ZERION_API_KEY)", () => {
  before(() => {
    if (SKIP) console.log(`  ${SKIP_MSG}`);
  });

  describe("portfolio", () => {
    it("returns portfolio for valid address", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["portfolio", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.wallet);
      assert.ok(json.portfolio);
      assert.ok(typeof json.portfolio.total === "number");
    });

    it("works with ENS name", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["portfolio", "vitalik.eth"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.wallet);
      assert.equal(json.wallet.name, "vitalik.eth");
    });
  });

  describe("positions", () => {
    it("returns positions array", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["positions", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["positions", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by --positions simple", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["positions", VITALIK, "--positions", "simple"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by --positions defi", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["positions", VITALIK, "--positions", "defi"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.positions));
    });
  });

  describe("transactions", () => {
    it("returns transactions data", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["history", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.transactions));
    });

    it("respects custom limit", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["history", VITALIK, "--limit", "5"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.transactions.length <= 5);
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["history", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
    });
  });

  describe("pnl", () => {
    it("returns PnL data", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["pnl", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.wallet);
      assert.ok(json.pnl);
    });
  });

  describe("chains", () => {
    it("returns chains array", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["chains"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.chains));
      assert.ok(json.chains.length > 0);
    });
  });

  describe("analyze", () => {
    it("returns full analysis", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["analyze", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.wallet);
      assert.ok(json.portfolio);
      assert.ok(json.positions);
      assert.ok(json.pnl);
    });

    it("analyze works with ENS", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["analyze", "vitalik.eth"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.equal(json.label, "vitalik.eth");
    });

    it("analyze with chain filter", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["analyze", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
    });
  });

  describe("error handling", () => {
    it("invalid API key returns error", { skip: false }, async () => {
      const result = await new Promise((resolve) => {
        execFile(
          "node",
          [BIN, "pnl", VITALIK],
          { env: { ...process.env, ZERION_API_KEY: "zk_dev_invalid_key_12345" }, timeout: 15000 },
          (error, stdout, stderr) => {
            resolve({ code: error?.code ?? 0, stderr });
          }
        );
      });

      assert.equal(result.code, 1);
      // Node can emit deprecation warnings (e.g. DEP0040 punycode) ahead of
      // the CLI's JSON error output on stderr. Parse from the first '{'.
      const json = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
      assert.equal(json.error.code, "api_error");
    });
  });
});
