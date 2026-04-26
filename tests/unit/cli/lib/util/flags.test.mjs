import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlags } from "#zerion/lib/util/flags.js";

describe("parseFlags", () => {
  it("returns empty rest and flags for empty argv", () => {
    const result = parseFlags([]);
    assert.deepEqual(result, { rest: [], flags: {} });
  });

  it("collects positional args into rest", () => {
    const result = parseFlags(["wallet", "analyze", "0xABC"]);
    assert.deepEqual(result.rest, ["wallet", "analyze", "0xABC"]);
    assert.deepEqual(result.flags, {});
  });

  it("parses --key value (space-separated)", () => {
    const result = parseFlags(["--chain", "ethereum"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("parses --key=value (equals-separated)", () => {
    const result = parseFlags(["--chain=ethereum"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("parses --flag alone as boolean true", () => {
    const result = parseFlags(["--help"]);
    assert.equal(result.flags.help, true);
  });

  it("parses --no-flag as false", () => {
    const { flags } = parseFlags(["--no-simulate"]);
    assert.equal(flags.simulate, false);
  });

  it("handles mixed positional args and flags", () => {
    const result = parseFlags(["wallet", "positions", "0xABC", "--chain", "ethereum"]);
    assert.deepEqual(result.rest, ["wallet", "positions", "0xABC"]);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("handles --flag1 --flag2 value (flag1 is boolean, flag2 has value)", () => {
    const result = parseFlags(["--verbose", "--chain", "ethereum"]);
    assert.equal(result.flags.verbose, true);
    assert.equal(result.flags.chain, "ethereum");
  });

  it("handles --key= as empty string value", () => {
    const result = parseFlags(["--chain="]);
    assert.equal(result.flags.chain, "");
  });

  it("preserves full value with --key=a=b (splits on first = only)", () => {
    const result = parseFlags(["--url=https://a.com?k=v"]);
    assert.equal(result.flags.url, "https://a.com?k=v");
  });

  it("last duplicate flag wins", () => {
    const result = parseFlags(["--chain", "ethereum", "--chain", "base"]);
    assert.equal(result.flags.chain, "base");
  });

  it("treats -h (single dash) as positional arg, not flag", () => {
    const result = parseFlags(["-h"]);
    assert.deepEqual(result.rest, ["-h"]);
    assert.deepEqual(result.flags, {});
  });

  it("handles -- separator", () => {
    const { rest, flags } = parseFlags(["--yes", "--", "extra", "args"]);
    assert.equal(flags.yes, true);
    assert.deepEqual(rest, ["extra", "args"]);
  });
});

describe("parseFlags (router command parsing)", () => {
  it("parses two-word command: wallet create", () => {
    const { rest, flags } = parseFlags(["wallet", "create", "--name", "test"]);
    assert.equal(rest[0], "wallet");
    assert.equal(rest[1], "create");
    assert.equal(flags.name, "test");
  });

  it("parses single-word command: config list", () => {
    const { rest } = parseFlags(["config", "list"]);
    assert.equal(rest[0], "config");
    assert.equal(rest[1], "list");
  });

  it("parses --version flag", () => {
    const { flags } = parseFlags(["--version"]);
    assert.equal(flags.version, true);
  });
});
