import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSupportedNodeVersion } from "#zerion/utils/common/node-version.js";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));

// Preload that makes the CLI see a different Node version.
function fakeNodeVersion(version) {
  const code = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  return `--import=data:text/javascript,${encodeURIComponent(code)}`;
}

describe("isSupportedNodeVersion", () => {
  for (const version of ["20.19.0", "20.20.1", "22.12.0", "22.23.1", "23.0.0", "24.18.0", "v22.12.0"]) {
    it(`accepts ${version}`, () => {
      assert.equal(isSupportedNodeVersion(version), true);
    });
  }

  for (const version of ["18.20.8", "20.0.0", "20.18.3", "21.7.3", "22.0.0", "22.11.0", "v22.11.0"]) {
    it(`rejects ${version}`, () => {
      assert.equal(isSupportedNodeVersion(version), false);
    });
  }
});

describe("zerion on unsupported Node", () => {
  it("exits with a structured unsupported_node error", () => {
    const result = spawnSync(process.execPath, [fakeNodeVersion("22.11.0"), BIN, "--version"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const { error } = JSON.parse(result.stderr);
    assert.equal(error.code, "unsupported_node");
    assert.equal(error.nodeVersion, "22.11.0");
    assert.equal(error.required, "^20.19.0 || >=22.12.0");
    assert.match(error.message, /Node\.js 22\.11\.0 is not supported/);
    assert.ok(error.suggestion);
  });
});
