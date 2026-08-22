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

  // --yes runs a real browser login on a TTY, so the non-TTY bail-out is what
  // keeps an unattended `init -y` from blocking on the 5-minute loopback wait.
  it("--yes still bails out to non_tty when stdin is not interactive", () => {
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
      assert.equal(auth.reason, "non_tty");
      assert.match(res.stderr, /zerion config set apiKey/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // `-y` is a shorthand the flag parser can't see (it only handles `--flags`),
  // so the router lifts it. Before that it was silently dropped, and the
  // "non-interactive" command still showed the auth picker.
  it("honors the -y shorthand, not just --yes", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const args = ["init", "--no-install", "--no-auth", "--no-skills"];
      const withShorthand = runZerion([...args, "-y"], { env: { HOME: dir } });
      const withoutFlag = runZerion(args, { env: { HOME: dir } });

      const parse = (res) => {
        const lines = res.stdout.trim().split("\n");
        return JSON.parse(lines.slice(lines.findIndex((l) => l === "{")).join("\n"));
      };

      assert.equal(parse(withShorthand).nonInteractive, true);
      assert.equal(parse(withoutFlag).nonInteractive, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The old onboarding one-liner (`npx -y zerion-cli init -y --browser`) must
  // keep working verbatim — `--browser` is now implied, not removed.
  it("accepts the legacy --browser flag as a no-op", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills", "-y", "--browser"], {
        env: { HOME: dir, ZERION_API_KEY: "" },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      const lines = res.stdout.trim().split("\n");
      const jsonStart = lines.findIndex((line) => line === "{");
      const out = JSON.parse(lines.slice(jsonStart).join("\n"));

      const auth = out.steps.find((s) => s.step === "auth");
      assert.equal(auth.reason, "non_tty", "same outcome as without --browser");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // `zerion init --help` is swallowed by the router's global help branch, so the
  // usage JSON is the surface that actually documents the install command.
  it("usage documents the short one-liner, not the old flag pile", () => {
    const res = runZerion(["--help"]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);

    const usage = JSON.parse(res.stdout);
    assert.match(usage.setup.init, /npx zerion-cli init/);
    assert.ok(usage.setup["init -y"], "non-interactive form is documented");
    assert.ok(usage.setup["init --no-open"], "headless escape hatch is documented");
    assert.equal(usage.setup["init -y --browser"], undefined, "old long form is gone");
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
