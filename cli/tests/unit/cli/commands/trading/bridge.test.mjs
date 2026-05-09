// Bridge command — flag validation and early-exit paths.
//
// These tests exec the CLI as a subprocess so the in-process monkey-patching
// of `process.stdout.write` (needed to capture printError output) doesn't
// interfere with node:test's own reporter. We assert exit code + parsed JSON
// error from stderr — the same surface agent integrations rely on.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..", "..");
const CLI_PATH = join(REPO_ROOT, "cli", "zerion.js");

function runBridge(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "bridge", ...args],
    {
      env: { ...process.env, ZERION_API_KEY: "zk_unit_test", ...env },
      encoding: "utf-8",
      timeout: 5000,
    },
  );
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseError(stderr) {
  if (!stderr) return null;
  try {
    return JSON.parse(stderr).error;
  } catch {
    return null;
  }
}

describe("bridge — early-exit validation", () => {
  it("rejects missing args with a usage message", () => {
    const { exitCode, stderr } = runBridge([]);
    assert.equal(exitCode, 1);
    assert.equal(parseError(stderr).code, "missing_args");
  });

  it("rejects non-numeric amount", () => {
    const { exitCode, stderr } = runBridge(["base", "USDC", "abc", "arbitrum", "USDC"]);
    assert.equal(exitCode, 1);
    assert.equal(parseError(stderr).code, "invalid_amount");
  });

  it("rejects same-chain bridge with a swap suggestion", () => {
    const { exitCode, stderr } = runBridge(["base", "USDC", "5", "base", "USDC"]);
    assert.equal(exitCode, 1);
    const err = parseError(stderr);
    assert.equal(err.code, "same_chain_bridge");
    assert.match(err.example, /^zerion swap base/);
  });

  it("rejects --fast with a non-boolean string value", () => {
    // `--fast=anything` is a real value; only "true"/"false" are accepted.
    const { exitCode, stderr } = runBridge([
      "base", "USDC", "5", "arbitrum", "USDC", "--fast=cheapest",
    ]);
    assert.equal(exitCode, 1);
    const err = parseError(stderr);
    assert.equal(err.code, "invalid_flag_value");
    assert.match(err.message, /--fast does not take a value/);
  });

  it("accepts --fast=true and --fast=false", () => {
    // Both forms are valid bool-flag conventions. `--fast=false` should
    // behave like the flag is unset, not like an error.
    for (const form of ["--fast=true", "--fast=false"]) {
      const { stderr } = runBridge([
        "base", "USDC", "5", "arbitrum", "USDC", form,
      ]);
      const err = parseError(stderr);
      if (err) {
        assert.notEqual(
          err.code,
          "invalid_flag_value",
          `${form} should be accepted as a boolean form`,
        );
      }
    }
  });

  it("rejects --cheapest with a non-boolean string value", () => {
    const { exitCode, stderr } = runBridge([
      "base", "USDC", "5", "arbitrum", "USDC", "--cheapest=anything",
    ]);
    assert.equal(exitCode, 1);
    assert.equal(parseError(stderr).code, "invalid_flag_value");
  });

  it("rejects mid-position --fast (parseFlags consumed a positional arg)", () => {
    // `bridge --fast base USDC 5 arbitrum USDC` — parseFlags consumes "base"
    // as the value of --fast, leaving rest=[USDC, 5, arbitrum, USDC] (only 4
    // positional args). Either error is acceptable: missing_args (the args
    // check fires first because parseFlags ate "base") or invalid_flag_value
    // (if the validator runs first). What matters is the user gets a non-zero
    // exit and not a silent fast-mode execution with mangled chain args.
    const { exitCode, stderr } = runBridge([
      "--fast", "base", "USDC", "5", "arbitrum", "USDC",
    ]);
    assert.equal(exitCode, 1);
    const code = parseError(stderr)?.code;
    assert.ok(
      code === "missing_args" || code === "invalid_flag_value",
      `expected missing_args or invalid_flag_value, got ${code}`,
    );
  });

  it("rejects --fast and --cheapest passed together", () => {
    const { exitCode, stderr } = runBridge([
      "base", "USDC", "5", "arbitrum", "USDC", "--fast", "--cheapest",
    ]);
    assert.equal(exitCode, 1);
    assert.equal(parseError(stderr).code, "conflicting_flags");
  });

  it("rejects invalid slippage values", () => {
    for (const bad of ["abc", "-5", "200", "2abc", "2.5xyz", " "]) {
      const { exitCode, stderr } = runBridge([
        "base", "USDC", "5", "arbitrum", "USDC", `--slippage=${bad}`, "--cheapest",
      ]);
      assert.equal(exitCode, 1, `expected exit on slippage="${bad}"`);
      assert.equal(
        parseError(stderr).code,
        "invalid_slippage",
        `wrong code for slippage="${bad}"`,
      );
    }
  });

  it("treats --no-fast as unset, NOT as a string-valued flag", () => {
    // parseFlags assigns `flags.fast = false` for the explicit-disable form.
    // Bridge should not raise invalid_flag_value — the user explicitly asked
    // to turn the flag off, semantically equivalent to not passing it.
    // Downstream errors (no wallet, no API mock) are acceptable; we only
    // care that the flag validator didn't reject the disabled form.
    const { stderr } = runBridge([
      "base", "USDC", "5", "arbitrum", "USDC", "--no-fast",
    ]);
    const err = parseError(stderr);
    if (err) {
      assert.notEqual(
        err.code,
        "invalid_flag_value",
        "flag validator should accept --no-fast (false) as unset",
      );
    }
  });

  it("treats --no-cheapest as unset, NOT as a string-valued flag", () => {
    const { stderr } = runBridge([
      "base", "USDC", "5", "arbitrum", "USDC", "--no-cheapest",
    ]);
    const err = parseError(stderr);
    if (err) {
      assert.notEqual(err.code, "invalid_flag_value");
    }
  });
});
