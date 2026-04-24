import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(import.meta.resolve("#zerion/cli/zerion.js"));

function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...process.env, ZERION_API_KEY: "", ...env } },
      (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      }
    );
  });
}

function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

describe("CLI routing", () => {
  describe("help output", () => {
    it("shows help with no args (exit 0)", async () => {
      const { code, stdout } = await run([]);
      assert.equal(code, 0);
      const json = parseJSON(stdout);
      assert.ok(json);
      assert.ok(json.usage);
      assert.ok(json.wallet_management);
      assert.ok(json.flags);
    });

    it("shows help with --help (exit 0)", async () => {
      const { code, stdout } = await run(["--help"]);
      assert.equal(code, 0);
      const json = parseJSON(stdout);
      assert.ok(json);
      assert.ok(json.wallet_management);
    });

    it("shows help with -h (exit 0)", async () => {
      const { code, stdout } = await run(["-h"]);
      assert.equal(code, 0);
      assert.ok(parseJSON(stdout));
    });

    it("shows version with --version", async () => {
      const { code, stdout } = await run(["--version"]);
      assert.equal(code, 0);
      assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
    });
  });

  describe("command routing", () => {
    it("wallet list shows wallets", async () => {
      const { code, stdout } = await run(["wallet", "list", "--json"]);
      assert.equal(code, 0);
      const json = parseJSON(stdout);
      assert.ok(json);
      assert.ok(Array.isArray(json.wallets));
    });
  });

  describe("error routing", () => {
    it("unknown command → error, exit 1", async () => {
      const { code, stderr } = await run(["foo", "bar"]);
      assert.equal(code, 1);
      const json = parseJSON(stderr);
      assert.ok(json);
      assert.equal(json.error.code, "unknown_command");
    });

    it("wallet analyze removed → unknown_command, exit 1", async () => {
      const { code, stderr } = await run(["wallet", "analyze"]);
      assert.equal(code, 1);
      const json = parseJSON(stderr);
      assert.ok(json);
      assert.equal(json.error.code, "unknown_command");
    });

    it("analyze with no address and no default wallet → no_wallet, exit 1", async () => {
      const { code, stderr } = await run(["analyze"], {
        HOME: "/tmp/zerion-test-nonexistent",
      });
      assert.equal(code, 1);
      const json = parseJSON(stderr);
      assert.ok(json);
      assert.equal(json.error.code, "no_wallet");
    });

    it("portfolio with no address and no default wallet → no_wallet, exit 1", async () => {
      // Only fails if no default wallet is configured
      const { code, stderr } = await run(["portfolio"], {
        HOME: "/tmp/zerion-test-nonexistent",
      });
      assert.equal(code, 1);
      const json = parseJSON(stderr);
      assert.ok(json);
      assert.ok(json.error);
    });
  });

  describe("output format", () => {
    it("all error outputs are valid JSON on stderr", async () => {
      const errorCases = [
        ["wallet", "analyze"],         // unknown_command (removed subcommand)
        ["foo", "bar"],                // unknown_command
      ];

      for (const args of errorCases) {
        const { stderr } = await run(args);
        if (stderr.trim()) {
          const json = parseJSON(stderr);
          assert.ok(json, `Invalid JSON on stderr for args: ${args.join(" ")}`);
          assert.ok(json.error, `Missing error key for args: ${args.join(" ")}`);
        }
      }
    });

    it("help output is valid JSON on stdout with required keys", async () => {
      const { stdout } = await run([]);
      const json = parseJSON(stdout);
      assert.ok(json);
      assert.ok(json.usage);
      assert.ok(json.wallet_management);
      assert.ok(json.flags);
    });
  });
});
