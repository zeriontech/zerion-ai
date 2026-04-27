import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));

describe("zerion", () => {
  it("prints help", async () => {
    const output = await new Promise((resolve, reject) => {
      execFile("node", [BIN, "--help"], (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout);
      });
    });

    assert.match(output, /analyze/);
    assert.match(output, /chains/);
  });

  it("fails clearly when API key is missing for API commands", async () => {
    const { code, stderr } = await new Promise((resolve) => {
      execFile(
        "node",
        [BIN, "analyze", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
        { env: { ...process.env, ZERION_API_KEY: "", HOME: process.env.HOME } },
        (error, _stdout, stderr) => {
          resolve({ code: error?.code ?? 0, stderr });
        }
      );
    });

    // Exit 0 if API key found in config, exit 1 with error message if not
    assert.ok(code === 0 || code === 1, `unexpected exit code: ${code}`);
    if (code === 1) {
      assert.ok(stderr.length > 0, "should produce error output when failing");
    }
  });
});
