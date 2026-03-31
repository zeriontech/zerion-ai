import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlags } from "../cli/lib/util/flags.js";

describe("parseFlags (wallet-cli)", () => {
  it("parses --key value (space-separated)", () => {
    const { rest, flags } = parseFlags(["--chain", "ethereum"]);
    assert.deepEqual(rest, []);
    assert.equal(flags.chain, "ethereum");
  });

  it("parses --key=value", () => {
    const { flags } = parseFlags(["--slippage=2.5"]);
    assert.equal(flags.slippage, "2.5");
  });

  it("parses boolean flag", () => {
    const { flags } = parseFlags(["--yes"]);
    assert.equal(flags.yes, true);
  });

  it("parses --no-flag as false", () => {
    const { flags } = parseFlags(["--no-simulate"]);
    assert.equal(flags.simulate, false);
  });

  it("separates positional args from flags", () => {
    const { rest, flags } = parseFlags(["wallet", "create", "--name", "bot-1"]);
    assert.deepEqual(rest, ["wallet", "create"]);
    assert.equal(flags.name, "bot-1");
  });

  it("handles -- separator", () => {
    const { rest, flags } = parseFlags(["--yes", "--", "extra", "args"]);
    assert.equal(flags.yes, true);
    assert.deepEqual(rest, ["extra", "args"]);
  });

  it("handles empty argv", () => {
    const { rest, flags } = parseFlags([]);
    assert.deepEqual(rest, []);
    assert.deepEqual(flags, {});
  });

  it("handles mixed positional and flags", () => {
    const { rest, flags } = parseFlags(["swap", "ETH", "USDC", "0.1", "--chain", "base", "--yes"]);
    assert.deepEqual(rest, ["swap", "ETH", "USDC", "0.1"]);
    assert.equal(flags.chain, "base");
    assert.equal(flags.yes, true);
  });
});

describe("router command parsing", () => {
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

  it("parses --help flag", () => {
    const { flags } = parseFlags(["--help"]);
    assert.equal(flags.help, true);
  });

  it("parses --version flag", () => {
    const { flags } = parseFlags(["--version"]);
    assert.equal(flags.version, true);
  });
});
