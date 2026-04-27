import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZERION_BIN = fileURLToPath(new URL("../../../../zerion.js", import.meta.url));

function runZerion(args, opts = {}) {
  return spawnSync("node", [ZERION_BIN, ...args], {
    encoding: "utf8",
    env: process.env,
    ...opts,
  });
}

describe("zerion setup", () => {
  it("setup with no args prints usage including skills", () => {
    const res = runZerion(["setup"]);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.match(out.usage, /setup/);
    assert.ok(out.subcommands["setup skills"]);
  });

  it("unknown subcommand fails with structured error", () => {
    const res = runZerion(["setup", "bogus"]);
    assert.notEqual(res.status, 0);
    const err = JSON.parse(res.stderr);
    assert.equal(err.error.code, "unknown_subcommand");
    assert.equal(err.error.subcommand, "bogus");
  });

  describe("setup skills", () => {
    it("--dry-run prints the npx command without executing", () => {
      const res = runZerion(["setup", "skills", "--dry-run"]);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.equal(out.dryRun, true);
      assert.match(out.command, /npx -y skills add zeriontech\/zerion-ai/);
      assert.equal(out.source, "zeriontech/zerion-ai");
    });

    it("--global passes -g to npx skills", () => {
      const res = runZerion(["setup", "skills", "--dry-run", "--global"]);
      const out = JSON.parse(res.stdout);
      assert.match(out.command, /\s-g(\s|$)/);
    });

    it("--agent passes -a <name> to npx skills", () => {
      const res = runZerion(["setup", "skills", "--dry-run", "--agent", "claude-code"]);
      const out = JSON.parse(res.stdout);
      assert.match(out.command, /-a claude-code/);
    });

    it("--yes passes --yes to npx skills", () => {
      const res = runZerion(["setup", "skills", "--dry-run", "--yes"]);
      const out = JSON.parse(res.stdout);
      assert.match(out.command, /--yes/);
    });
  });
});
