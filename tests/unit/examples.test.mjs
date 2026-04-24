import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL(".", import.meta.resolve("#zerion")));

function readJSON(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

describe("examples", () => {
  describe("cursor/mcp.json", () => {
    it("exists and is valid JSON", () => {
      const data = readJSON("examples/cursor/mcp.json");
      assert.ok(data.mcpServers);
      assert.ok(data.mcpServers.zerion);
    });

    it("uses correct MCP URL", () => {
      const data = readJSON("examples/cursor/mcp.json");
      assert.equal(data.mcpServers.zerion.url, "https://developers.zerion.io/mcp");
    });

    it("uses Bearer auth", () => {
      const data = readJSON("examples/cursor/mcp.json");
      assert.match(data.mcpServers.zerion.headers.Authorization, /^Bearer /);
    });
  });

  describe("claude/mcp.json", () => {
    it("exists and is valid JSON", () => {
      const data = readJSON("examples/claude/mcp.json");
      assert.ok(data.mcpServers);
      assert.ok(data.mcpServers.zerion);
    });

    it("uses same MCP URL as cursor config", () => {
      const cursor = readJSON("examples/cursor/mcp.json");
      const claude = readJSON("examples/claude/mcp.json");
      assert.equal(cursor.mcpServers.zerion.url, claude.mcpServers.zerion.url);
    });

    it("uses Bearer auth", () => {
      const data = readJSON("examples/claude/mcp.json");
      assert.match(data.mcpServers.zerion.headers.Authorization, /^Bearer /);
    });
  });

  describe("openclaw/tool.json", () => {
    it("exists and is valid JSON", () => {
      const data = readJSON("examples/openclaw/tool.json");
      assert.ok(data);
    });

    it("has correct command", () => {
      const data = readJSON("examples/openclaw/tool.json");
      assert.equal(data.command, "zerion");
    });

    it("has analyze args structure", () => {
      const data = readJSON("examples/openclaw/tool.json");
      assert.ok(Array.isArray(data.args));
      assert.ok(data.args.includes("analyze"));
    });

    it("requires ZERION_API_KEY env", () => {
      const data = readJSON("examples/openclaw/tool.json");
      assert.ok(Array.isArray(data.env));
      assert.ok(data.env.includes("ZERION_API_KEY"));
    });
  });

  describe("openai-agents/wallet_analysis.py", () => {
    it("exists", () => {
      assert.ok(existsSync(join(ROOT, "examples/openai-agents/wallet_analysis.py")));
    });

    it("has valid Python syntax", () => {
      try {
        execFileSync(
          "python3",
          [
            "-c",
            "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())",
            join(ROOT, "examples/openai-agents/wallet_analysis.py")
          ]
        );
      } catch (e) {
        // Skip if python3 is not available
        if (e.code === "ENOENT") {
          return;
        }
        assert.fail(`Python syntax error: ${e.stderr?.toString()}`);
      }
    });

    it("uses URL encoding for addresses", () => {
      const content = readFileSync(join(ROOT, "examples/openai-agents/wallet_analysis.py"), "utf8");
      assert.match(content, /from urllib\.parse import quote/);
      assert.match(content, /quote\(address/);
    });
  });

  describe("http/curl.md", () => {
    it("exists", () => {
      assert.ok(existsSync(join(ROOT, "examples/http/curl.md")));
    });

    it("covers all 5 endpoints", () => {
      const content = readFileSync(join(ROOT, "examples/http/curl.md"), "utf8");
      assert.match(content, /\/portfolio/);
      assert.match(content, /\/positions/);
      assert.match(content, /\/transactions/);
      assert.match(content, /\/pnl/);
      assert.match(content, /\/chains/);
    });

    it("uses --globoff for bracket params", () => {
      const content = readFileSync(join(ROOT, "examples/http/curl.md"), "utf8");
      assert.match(content, /--globoff/);
    });
  });

  describe("example wallet addresses", () => {
    it("all hex addresses in README are 42 characters", () => {
      const content = readFileSync(join(ROOT, "README.md"), "utf8");
      const hexAddresses = content.match(/0x[0-9a-fA-F]{40,44}/g) || [];
      for (const addr of hexAddresses) {
        assert.equal(addr.length, 42, `Address ${addr} is ${addr.length} chars, expected 42`);
      }
    });

    it("all hex addresses in skills README are 42 characters", () => {
      const content = readFileSync(join(ROOT, "skills/wallet-analysis/README.md"), "utf8");
      const hexAddresses = content.match(/0x[0-9a-fA-F]{40,44}/g) || [];
      for (const addr of hexAddresses) {
        assert.equal(addr.length, 42, `Address ${addr} is ${addr.length} chars, expected 42`);
      }
    });
  });
});
