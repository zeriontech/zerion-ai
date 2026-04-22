import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL(".", import.meta.resolve("#zerion")));
const toolsDir = join(ROOT, "mcp/tools");

const EXPECTED_FILES = [
  "wallet-portfolio.json",
  "wallet-positions.json",
  "wallet-transactions.json",
  "wallet-pnl.json",
  "chains-list.json",
  "swap.json",
  "wallet-create.json",
  "search.json"
];

function loadTool(filename) {
  return JSON.parse(readFileSync(join(toolsDir, filename), "utf8"));
}

describe("tool catalog", () => {
  it("has all 8 expected tool files", () => {
    const files = readdirSync(toolsDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 8);
    for (const expected of EXPECTED_FILES) {
      assert.ok(files.includes(expected), `Missing tool file: ${expected}`);
    }
  });

  // API tools — full REST schema (kind, method, path, auth, source)
  const API_TOOLS = [
    "wallet-portfolio.json",
    "wallet-positions.json",
    "wallet-transactions.json",
    "wallet-pnl.json",
    "chains-list.json"
  ];

  // CLI tools — simpler schema (name, description, inputSchema, cli)
  const CLI_TOOLS = [
    "swap.json",
    "wallet-create.json",
    "search.json"
  ];

  describe("API tool schema", () => {
    for (const file of API_TOOLS) {
      describe(file, () => {
        let data;

        it("is valid JSON with required fields", () => {
          data = loadTool(file);
          assert.equal(typeof data.name, "string");
          assert.equal(typeof data.kind, "string");
          assert.equal(typeof data.method, "string");
          assert.equal(typeof data.path, "string");
          assert.equal(typeof data.auth, "string");
          assert.equal(typeof data.description, "string");
          assert.equal(typeof data.input, "object");
          assert.equal(typeof data.responseShape, "object");
          assert.equal(typeof data.source, "string");
        });

        it("uses GET method", () => {
          data = data || loadTool(file);
          assert.equal(data.method, "GET");
        });

        it("uses Basic auth", () => {
          data = data || loadTool(file);
          assert.equal(data.auth, "Basic");
        });

        it("has name matching filename stem", () => {
          data = data || loadTool(file);
          const stem = file.replace(".json", "");
          assert.equal(data.name, stem);
        });

        it("has valid source URL format", () => {
          data = data || loadTool(file);
          assert.doesNotThrow(() => new URL(data.source));
        });
      });
    }
  });

  describe("CLI tool schema", () => {
    for (const file of CLI_TOOLS) {
      describe(file, () => {
        it("is valid JSON with required fields", () => {
          const data = loadTool(file);
          assert.equal(typeof data.name, "string");
          assert.equal(typeof data.description, "string");
          assert.equal(typeof data.inputSchema, "object");
          assert.equal(typeof data.cli, "string");
        });

        it("has name matching filename stem", () => {
          const data = loadTool(file);
          const stem = file.replace(".json", "");
          assert.equal(data.name, stem);
        });
      });
    }
  });

  describe("wallet API tools", () => {
    const walletApiFiles = API_TOOLS.filter((f) => f.startsWith("wallet-"));

    for (const file of walletApiFiles) {
      it(`${file} has {address} in path`, () => {
        const data = loadTool(file);
        assert.match(data.path, /\{address\}/);
      });

      it(`${file} has required address input`, () => {
        const data = loadTool(file);
        assert.ok(data.input.address);
        assert.equal(data.input.address.type, "string");
        assert.equal(data.input.address.required, true);
      });
    }
  });

  describe("position filter support", () => {
    it("wallet-positions has filter[positions] with enum array", () => {
      const data = loadTool("wallet-positions.json");
      assert.ok(data.input["filter[positions]"]);
      assert.deepEqual(data.input["filter[positions]"].enum, ["only_simple", "only_complex", "no_filter"]);
    });
  });

  describe("chain filter support", () => {
    it("wallet-positions has optional filter[chain_ids]", () => {
      const data = loadTool("wallet-positions.json");
      assert.ok(data.input["filter[chain_ids]"]);
      assert.equal(data.input["filter[chain_ids]"].required, false);
    });

    it("wallet-transactions has optional filter[chain_ids]", () => {
      const data = loadTool("wallet-transactions.json");
      assert.ok(data.input["filter[chain_ids]"]);
      assert.equal(data.input["filter[chain_ids]"].required, false);
    });
  });

  describe("chains-list tool", () => {
    it("has no address in path", () => {
      const data = loadTool("chains-list.json");
      assert.ok(!data.path.includes("{address}"));
    });

    it("has empty input (no required params)", () => {
      const data = loadTool("chains-list.json");
      assert.deepEqual(data.input, {});
    });

    it("has kind: chain-capability", () => {
      const data = loadTool("chains-list.json");
      assert.equal(data.kind, "chain-capability");
    });
  });
});
