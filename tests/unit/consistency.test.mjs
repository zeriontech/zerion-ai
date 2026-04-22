import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { basicAuthHeader } from "#zerion/cli/lib/api/auth.js";

const ROOT = fileURLToPath(new URL(".", import.meta.resolve("#zerion")));
const toolsDir = join(ROOT, "mcp/tools");

function readJSON(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

function loadAllTools() {
  return readdirSync(toolsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(toolsDir, f), "utf8")));
}

describe("cross-integration consistency", () => {
  describe("CLI API paths match MCP tool paths", () => {
    it("wallet-portfolio path matches", () => {
      const tool = readJSON("mcp/tools/wallet-portfolio.json");
      assert.match(tool.path, /\/wallets\/\{address\}\/portfolio/);
    });

    it("wallet-positions path matches", () => {
      const tool = readJSON("mcp/tools/wallet-positions.json");
      assert.match(tool.path, /\/wallets\/\{address\}\/positions/);
    });

    it("wallet-transactions path matches", () => {
      const tool = readJSON("mcp/tools/wallet-transactions.json");
      assert.match(tool.path, /\/wallets\/\{address\}\/transactions/);
    });

    it("wallet-pnl path matches", () => {
      const tool = readJSON("mcp/tools/wallet-pnl.json");
      assert.match(tool.path, /\/wallets\/\{address\}\/pnl/);
    });

    it("chains-list path matches", () => {
      const tool = readJSON("mcp/tools/chains-list.json");
      assert.match(tool.path, /\/chains\//);
    });
  });

  describe("all API MCP tools use Basic auth (matching CLI)", () => {
    it("every API tool has auth: Basic", () => {
      const tools = loadAllTools().filter((t) => t.auth);
      for (const tool of tools) {
        assert.equal(tool.auth, "Basic", `Tool ${tool.name} has auth: ${tool.auth}`);
      }
    });
  });

  describe("all API methods are GET", () => {
    it("every API tool uses GET method", () => {
      const tools = loadAllTools().filter((t) => t.method);
      for (const tool of tools) {
        assert.equal(tool.method, "GET", `Tool ${tool.name} has method: ${tool.method}`);
      }
    });
  });

  describe("CLI and Python use same auth logic", () => {
    it("basicAuthHeader produces same result as Python _auth_header logic", () => {
      const key = "zk_dev_test123";
      const jsHeader = basicAuthHeader(key);
      // Python logic: base64.b64encode(f"{key}:".encode()).decode() → f"Basic {token}"
      const expectedToken = Buffer.from(`${key}:`).toString("base64");
      assert.equal(jsHeader, `Basic ${expectedToken}`);
    });
  });

  describe("same default API base URL", () => {
    it("Python example uses same default as CLI", () => {
      const pyContent = readFileSync(
        join(ROOT, "examples/openai-agents/wallet_analysis.py"),
        "utf8"
      );
      assert.match(pyContent, /https:\/\/api\.zerion\.io\/v1/);
    });
  });

  describe("wallet addresses are consistent and valid", () => {
    it("all addresses across README, skills README, and curl examples are 42 chars", () => {
      const files = [
        "README.md",
        "skills/wallet-analysis/README.md",
        "examples/http/curl.md"
      ];

      for (const file of files) {
        const content = readFileSync(join(ROOT, file), "utf8");
        const hexAddresses = content.match(/0x[0-9a-fA-F]{40,44}/g) || [];
        for (const addr of hexAddresses) {
          assert.equal(
            addr.length,
            42,
            `In ${file}: address ${addr} is ${addr.length} chars, expected 42`
          );
        }
      }
    });
  });

  describe("every CLI wallet subcommand has a corresponding MCP tool", () => {
    it("portfolio, positions, transactions, pnl all have tools", () => {
      const tools = loadAllTools();
      const toolNames = new Set(tools.map((t) => t.name));

      const expectedTools = [
        "wallet-portfolio",
        "wallet-positions",
        "wallet-transactions",
        "wallet-pnl"
      ];

      for (const name of expectedTools) {
        assert.ok(toolNames.has(name), `Missing MCP tool: ${name}`);
      }
    });

    it("chains list has a tool", () => {
      const tools = loadAllTools();
      const toolNames = new Set(tools.map((t) => t.name));
      assert.ok(toolNames.has("chains-list"), "Missing MCP tool: chains-list");
    });
  });

  describe("wallet tools require address input", () => {
    it("all wallet tools have required address input", () => {
      const walletTools = [
        "wallet-portfolio",
        "wallet-positions",
        "wallet-transactions",
        "wallet-pnl"
      ];

      for (const name of walletTools) {
        const tool = readJSON(`mcp/tools/${name}.json`);
        assert.ok(tool.input.address, `Tool ${name} missing address input`);
        assert.equal(tool.input.address.required, true, `Tool ${name} address not required`);
      }
    });
  });

  describe("tool names match filenames", () => {
    it("each file's name field matches the filename stem", () => {
      const files = readdirSync(toolsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const data = JSON.parse(readFileSync(join(toolsDir, file), "utf8"));
        const stem = file.replace(".json", "");
        assert.equal(data.name, stem, `File ${file} has name '${data.name}', expected '${stem}'`);
      }
    });
  });
});
