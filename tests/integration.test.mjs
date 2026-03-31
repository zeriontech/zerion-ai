import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "../cli/zerion-cli.js");

const API_KEY = process.env.ZERION_API_KEY || "";
const SKIP = !API_KEY;
const SKIP_MSG = "Skipping: ZERION_API_KEY not set";

const VITALIK = "0x42b9dF65B219B3dD36FF330A4dD8f327A6Ada990";

function run(args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...process.env, ZERION_API_KEY: API_KEY }, timeout: 30000 },
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
      const { code, json } = await run(["wallet", "portfolio", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.data);
      assert.ok(json.data.attributes);
    });

    it("works with ENS name", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "portfolio", "vitalik.eth"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.data);
    });
  });

  describe("positions", () => {
    it("returns positions array", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "positions", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.data));
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "positions", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.data));
    });

    it("filters by --positions simple", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "positions", VITALIK, "--positions", "simple"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.data));
    });

    it("filters by --positions defi", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "positions", VITALIK, "--positions", "defi"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.data));
    });
  });

  describe("transactions", () => {
    it("returns transactions data", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "transactions", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.data);
    });

    it("respects custom limit", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "transactions", VITALIK, "--limit", "5"]);
      assert.equal(code, 0);
      assert.ok(json);
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "transactions", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
    });
  });

  describe("pnl", () => {
    it("returns PnL data", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "pnl", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.data);
      assert.ok(json.data.attributes);
    });
  });

  describe("chains", () => {
    it("returns chains array", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["chains", "list"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.data));
      assert.ok(json.data.length > 0);
    });
  });

  describe("analyze", () => {
    it("returns full analysis", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "analyze", VITALIK]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(json.wallet);
      assert.ok(json.portfolio);
      assert.ok(json.positions);
      assert.ok(json.transactions);
      assert.ok(json.pnl);
    });

    it("analyze works with ENS", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "analyze", "vitalik.eth"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.equal(json.wallet.query, "vitalik.eth");
    });

    it("analyze with chain filter", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["wallet", "analyze", VITALIK, "--chain", "ethereum"]);
      assert.equal(code, 0);
      assert.ok(json);
    });
  });

  describe("error handling", () => {
    it("invalid API key returns error", { skip: false }, async () => {
      const result = await new Promise((resolve) => {
        execFile(
          "node",
          [BIN, "wallet", "pnl", VITALIK],
          { env: { ...process.env, ZERION_API_KEY: "zk_dev_invalid_key_12345" }, timeout: 15000 },
          (error, stdout, stderr) => {
            resolve({ code: error?.code ?? 0, stderr });
          }
        );
      });

      assert.equal(result.code, 1);
      const json = JSON.parse(result.stderr);
      assert.equal(json.error.code, "api_error");
    });
  });
});
