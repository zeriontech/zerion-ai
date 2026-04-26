import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ZERION_BIN = fileURLToPath(new URL("../../../../cli/zerion.js", import.meta.url));

function runZerion(args, opts = {}) {
  return spawnSync("node", [ZERION_BIN, ...args], {
    encoding: "utf8",
    env: process.env,
    ...opts,
  });
}

describe("zerion setup", () => {
  it("setup with no args prints usage including skills + mcp", () => {
    const res = runZerion(["setup"]);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.match(out.usage, /setup/);
    assert.ok(out.subcommands["setup skills"]);
    assert.ok(out.subcommands["setup mcp"]);
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
      assert.match(out.command, /npx -y skills add zeriontech\/zerion-agent/);
      assert.equal(out.source, "zeriontech/zerion-agent");
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

  describe("setup mcp", () => {
    it("--print emits the canonical MCP fragment as JSON", () => {
      const res = runZerion(["setup", "mcp", "--print"]);
      assert.equal(res.status, 0);
      const data = JSON.parse(res.stdout);
      assert.ok(data.mcpServers?.zerion);
      assert.equal(data.mcpServers.zerion.url, "https://developers.zerion.io/mcp");
      assert.equal(data.mcpServers.zerion.type, "sse");
      assert.match(data.mcpServers.zerion.headers.Authorization, /\$\{ZERION_API_KEY\}/);
    });

    it("missing --agent fails with structured error", () => {
      const res = runZerion(["setup", "mcp"]);
      assert.notEqual(res.status, 0);
      const err = JSON.parse(res.stderr);
      assert.equal(err.error.code, "missing_agent");
      assert.deepEqual(err.error.supportedAgents, ["cursor", "claude-code", "claude-desktop"]);
    });

    it("unknown agent fails with structured error", () => {
      const res = runZerion(["setup", "mcp", "--agent", "bogus"]);
      assert.notEqual(res.status, 0);
      const err = JSON.parse(res.stderr);
      assert.equal(err.error.code, "unknown_agent");
    });

    it("--dry-run reports the target path without writing", () => {
      const res = runZerion(["setup", "mcp", "--agent", "cursor", "--dry-run"]);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.equal(out.dryRun, true);
      assert.equal(out.agent, "cursor");
      assert.match(out.target, /\.cursor\/mcp\.json$/);
    });

    it("writes Zerion server into a brand-new project cursor config", () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-setup-")));
      try {
        const res = runZerion(["setup", "mcp", "--agent", "cursor"], { cwd: dir });
        assert.equal(res.status, 0, `stderr: ${res.stderr}`);
        const out = JSON.parse(res.stdout);
        assert.equal(out.ok, true);
        assert.equal(out.target, join(dir, ".cursor", "mcp.json"));

        const written = JSON.parse(readFileSync(out.target, "utf8"));
        assert.equal(written.mcpServers.zerion.url, "https://developers.zerion.io/mcp");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("preserves existing mcpServers entries when merging", () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-setup-")));
      try {
        const targetDir = join(dir, ".cursor");
        const target = join(targetDir, "mcp.json");
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(
          target,
          JSON.stringify({
            mcpServers: {
              "other-server": { command: "/usr/local/bin/other" },
            },
          })
        );

        const res = runZerion(["setup", "mcp", "--agent", "cursor"], { cwd: dir });
        assert.equal(res.status, 0, `stderr: ${res.stderr}`);

        const written = JSON.parse(readFileSync(target, "utf8"));
        assert.ok(written.mcpServers["other-server"], "previous server preserved");
        assert.ok(written.mcpServers.zerion, "zerion server added");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
