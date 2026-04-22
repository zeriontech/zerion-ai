// `zerion chains` reads the supported-chains list from a local viem
// registry — no network, no API key, no auth of any kind. These tests
// spawn the CLI but stay fully offline.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(import.meta.resolve("#zerion/cli/zerion.js"));

function run(args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...process.env, ZERION_API_KEY: "" }, timeout: 5000 },
      (error, stdout) => {
        resolve({ code: error?.code ?? 0, stdout });
      }
    );
  });
}

function parseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

describe("chains — local list (no network, no API key)", () => {
  it("`zerion chains --json` returns chains array", async () => {
    const { code, stdout } = await run(["chains", "--json"]);
    assert.equal(code, 0);
    const json = parseJSON(stdout);
    assert.ok(json);
    assert.ok(json.chains);
    assert.ok(json.count > 0);
  });

  it("`zerion chains` defaults to JSON output", async () => {
    const { code, stdout } = await run(["chains"]);
    assert.equal(code, 0);
    const json = parseJSON(stdout);
    assert.ok(json);
    assert.ok(json.chains);
    assert.ok(json.count > 0);
  });

  it("`zerion chains list --json` works via single-word fallback", async () => {
    const { code, stdout } = await run(["chains", "list", "--json"]);
    assert.equal(code, 0);
    const json = parseJSON(stdout);
    assert.ok(json);
    assert.ok(json.chains);
    assert.ok(json.count > 0);
  });
});
