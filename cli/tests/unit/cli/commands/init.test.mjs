import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOlderVersion, detectRunningAgent, skillTargets } from "#zerion/commands/init.js";

const ZERION_BIN = fileURLToPath(new URL("../../../../zerion.js", import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8")
).version;

// Blank out every marker init uses to detect a coding agent, so a test run
// from inside Claude Code / Codex sees a plain non-TTY shell.
const NO_AGENT_ENV = Object.fromEntries(
  ["CLAUDECODE", "CLAUDE_CODE", "CURSOR_TRACE_ID", "CURSOR_AGENT", "CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID", "GEMINI_CLI"]
    .map((k) => [k, ""])
);

function parseResult(res) {
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines.slice(lines.findIndex((l) => l === "{")).join("\n"));
}

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
    assert.match(usage.setup.init, /npx zerion-cli@latest init/, "@latest — a bare name runs a stale global copy");
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

  // An agent's shell has no TTY, but a human is on the other side: init still
  // doesn't block, and hands the agent the login command to run instead.
  it("inside a coding agent, a missing key points at `zerion login --browser`", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills", "-y"], {
        env: { ...NO_AGENT_ENV, HOME: dir, ZERION_API_KEY: "", CODEX_THREAD_ID: "t-1" },
      });
      assert.equal(res.status, 0, `stderr: ${res.stderr}`);

      const auth = parseResult(res).steps.find((s) => s.step === "auth");
      assert.equal(auth.reason, "non_tty");
      assert.equal(auth.next, "zerion login --browser");
      assert.match(res.stderr, /Running inside codex/);
      assert.match(res.stderr, /zerion config set apiKey/, "key fallback still printed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("outside an agent, a missing key gets no login hint", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-skills", "-y"], {
        env: { ...NO_AGENT_ENV, HOME: dir, ZERION_API_KEY: "" },
      });
      const auth = parseResult(res).steps.find((s) => s.step === "auth");
      assert.equal(auth.next, undefined);
      assert.doesNotMatch(res.stderr, /Running inside/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Agents load skills at session start, so init points at the file directly.
  it("result names the packaged SKILL.md, and stderr tells agents to read it", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
    try {
      const res = runZerion(["init", "--no-install", "--no-auth", "--no-skills"], {
        env: { HOME: dir },
      });
      const out = parseResult(res);
      assert.match(out.skill, /skills\/zerion\/SKILL\.md$/);
      assert.ok(existsSync(out.skill), `${out.skill} exists`);
      assert.match(res.stderr, /Agents: before acting on the user's request, read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Under npx the temp copy is first on PATH, so the global install is looked
  // up via `npm root -g`. A fake npm stands in for both calls.
  describe("global install from npx", () => {
    function runFromNpx(globalVersion) {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "zerion-init-")));
      const npxDir = join(dir, "_npx", "abc");
      const binDir = join(dir, "bin");
      const globalRoot = join(dir, "global");
      mkdirSync(npxDir, { recursive: true });
      mkdirSync(binDir);
      symlinkSync(ZERION_BIN, join(npxDir, "zerion.js"));
      if (globalVersion) {
        mkdirSync(join(globalRoot, "zerion-cli"), { recursive: true });
        writeFileSync(join(globalRoot, "zerion-cli", "package.json"), JSON.stringify({ version: globalVersion }));
      }
      const callLog = join(dir, "npm-calls.log");
      writeFileSync(
        join(binDir, "npm"),
        `#!/bin/sh\nif [ "$1" = "root" ]; then echo "${globalRoot}"; exit 0; fi\necho "$@" >> "${callLog}"\n`
      );
      chmodSync(join(binDir, "npm"), 0o755);

      const res = spawnSync("node", [join(npxDir, "zerion.js"), "init", "--no-auth", "--no-skills"], {
        encoding: "utf8",
        env: { ...process.env, HOME: dir, PATH: `${binDir}:${process.env.PATH}` },
      });
      const calls = existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n") : [];
      rmSync(dir, { recursive: true, force: true });
      return { res, calls, install: parseResult(res).steps.find((s) => s.step === "install") };
    }

    it("installs when there is no global copy", () => {
      const { calls, install } = runFromNpx(null);
      assert.deepEqual(calls, [`install -g zerion-cli@${PKG_VERSION}`]);
      assert.equal(install.skipped, false);
    });

    it("upgrades an older global copy instead of skipping it", () => {
      const { calls, install } = runFromNpx("1.0.0");
      assert.deepEqual(calls, [`install -g zerion-cli@${PKG_VERSION}`]);
      assert.equal(install.from, "1.0.0");
    });

    it("leaves a current global copy alone", () => {
      const { calls, install } = runFromNpx(PKG_VERSION);
      assert.deepEqual(calls, []);
      assert.equal(install.skipped, true);
    });
  });
});

describe("isOlderVersion", () => {
  it("compares major.minor.patch numerically", () => {
    assert.equal(isOlderVersion("1.6.0", "1.9.1"), true);
    assert.equal(isOlderVersion("1.9.1", "1.10.0"), true);
    assert.equal(isOlderVersion("1.10.0", "1.9.1"), false);
    assert.equal(isOlderVersion("1.9.1", "1.9.1"), false);
  });

  it("treats a prerelease of the same version as not newer", () => {
    assert.equal(isOlderVersion("1.9.1", "1.9.1-next.20260824133608.g735d2e5"), false);
    assert.equal(isOlderVersion("1.9.0", "1.9.1-next.20260824133608.g735d2e5"), true);
  });

  // Stripping the prerelease left these stale installs in place.
  it("upgrades a prerelease to its release, and an older next build to a newer one", () => {
    assert.equal(isOlderVersion("1.9.1-next.20260824133608.g735d2e5", "1.9.1"), true);
    assert.equal(
      isOlderVersion("1.9.1-next.20260714143206.ga55957e", "1.9.1-next.20260824133608.g735d2e5"),
      true
    );
    assert.equal(
      isOlderVersion("1.9.1-next.20260824133608.g735d2e5", "1.9.1-next.20260714143206.ga55957e"),
      false
    );
  });

  it("follows semver precedence for prerelease identifiers and ignores build metadata", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(isOlderVersion(ordered[i - 1], ordered[i]), true, `${ordered[i - 1]} < ${ordered[i]}`);
      assert.equal(isOlderVersion(ordered[i], ordered[i - 1]), false, `${ordered[i]} !< ${ordered[i - 1]}`);
    }
    assert.equal(isOlderVersion("1.9.1+build.5", "1.9.1"), false);
  });
});

describe("skill install targets", () => {
  function withHome(dirs, fn) {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "zerion-home-")));
    try {
      for (const d of dirs) mkdirSync(join(home, d));
      return fn(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("detects Codex from its own markers, not CODEX_HOME", () => {
    assert.equal(detectRunningAgent({ CODEX_THREAD_ID: "t" }), "codex");
    assert.equal(detectRunningAgent({ CODEX_SANDBOX: "seatbelt" }), "codex");
    assert.equal(detectRunningAgent({ CODEX_HOME: "/x" }), null);
  });

  it("uses the id `skills` expects for Gemini CLI", () => {
    assert.equal(detectRunningAgent({ GEMINI_CLI: "1" }), "gemini-cli");
  });

  it("installs for the running agent first, then every agent on the machine", () => {
    withHome([".claude", ".codex"], (home) => {
      assert.deepEqual(skillTargets({ env: { CODEX_THREAD_ID: "t" }, home }), ["codex", "claude-code"]);
      assert.deepEqual(skillTargets({ env: {}, home }), ["claude-code", "codex"]);
    });
  });

  it("finds Codex under CODEX_HOME when it is relocated", () => {
    withHome(["elsewhere"], (home) => {
      assert.deepEqual(skillTargets({ env: { CODEX_HOME: join(home, "elsewhere") }, home }), ["codex"]);
    });
  });

  it("an explicit --agent wins", () => {
    withHome([".claude", ".codex"], (home) => {
      assert.deepEqual(skillTargets({ agent: "cursor", env: { CODEX_THREAD_ID: "t" }, home }), ["cursor"]);
    });
  });
});
