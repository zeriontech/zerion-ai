import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ZERION_BIN = fileURLToPath(new URL("../../../../zerion.js", import.meta.url));

function runZerion(args, opts = {}) {
  const { env: overrideEnv, ...rest } = opts;
  return spawnSync("node", [ZERION_BIN, ...args], {
    encoding: "utf8",
    ...rest,
    env: { ...process.env, ...overrideEnv },
  });
}

describe("zerion init", () => {
  it("--no-install --no-auth --no-skills returns ok with all steps skipped", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-auth", "--no-skills"], {
        env: { HOME: dir },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      // Final JSON line is the structured result; banner + step text go to stderr
      const lines = res.stdout.trim().split("\n");
      const jsonStart = lines.findIndex((line) => line === "{");
      const out = JSON.parse(lines.slice(jsonStart).join("\n"));

      assert.equal(out.ok, true);
      assert.equal(out.action, "init");
      assert.equal(out.steps.length, 3);
      for (const step of out.steps) {
        assert.equal(step.ok, true);
        assert.equal(step.skipped, true);
        assert.equal(step.reason, "flag");
      }
      assert.deepEqual(
        out.steps.map((s) => s.step),
        ["install", "auth", "skills"]
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auth step reports non_tty when stdin is not interactive and no key is set", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills"], {
        env: { HOME: dir, ZERION_API_KEY: "" },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      const lines = res.stdout.trim().split("\n");
      const jsonStart = lines.findIndex((line) => line === "{");
      const out = JSON.parse(lines.slice(jsonStart).join("\n"));

      const auth = out.steps.find((s) => s.step === "auth");
      assert.equal(auth.skipped, true);
      assert.equal(auth.reason, "non_tty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auth step reports non_interactive under --yes when no key is set", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills", "--yes"], {
        env: { HOME: dir, ZERION_API_KEY: "" },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      const lines = res.stdout.trim().split("\n");
      const jsonStart = lines.findIndex((line) => line === "{");
      const out = JSON.parse(lines.slice(jsonStart).join("\n"));

      const auth = out.steps.find((s) => s.step === "auth");
      assert.equal(auth.skipped, true);
      assert.equal(auth.reason, "non_interactive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auth step reports already-authenticated when ZERION_API_KEY is set", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills"], {
        env: { HOME: dir, ZERION_API_KEY: "zk_dev_test" },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      const lines = res.stdout.trim().split("\n");
      const jsonStart = lines.findIndex((line) => line === "{");
      const out = JSON.parse(lines.slice(jsonStart).join("\n"));

      const auth = out.steps.find((s) => s.step === "auth");
      assert.equal(auth.skipped, true);
      assert.equal(auth.reason, undefined, "no skip reason — already authenticated path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
