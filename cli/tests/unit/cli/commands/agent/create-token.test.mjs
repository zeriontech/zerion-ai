import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const commandUrl = import.meta.resolve("#zerion/commands/agent/create-token.js");
const flagsUrl = import.meta.resolve("#zerion/utils/common/flags.js");
const NOW = Date.parse("2026-09-22T10:35:59.329Z");
const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

// Load the actual command with in-memory dependencies: no keystore, policy,
// passphrase file, config, or network is used by these command regressions.
const mocks = {
  [import.meta.resolve("#zerion/utils/wallet/keystore.js")]: `
    export function getPolicy(id) { globalThis.calls.push(["policy", id]); }
    export function createAgentToken(...args) {
      globalThis.calls.push(["create", ...args]);
      return { name: args[0], wallet: args[1], token: "fixture-token" };
    }
  `,
  [import.meta.resolve("#zerion/utils/config.js")]: `
    export function getConfigValue(key) { globalThis.calls.push(["config", key]); }
    export function saveAgentToken(...args) { globalThis.calls.push(["save", ...args]); }
    export function setConfigValue(...args) { globalThis.calls.push(["set", ...args]); }
  `,
  [import.meta.resolve("#zerion/utils/common/prompt.js")]: `
    export async function readPassphrase() {
      globalThis.calls.push(["prompt"]);
      return "fixture-passphrase";
    }
    export function readPassphraseFromFile() { throw new Error("Unexpected file read"); }
  `,
  [import.meta.resolve("#zerion/utils/wallet/policy-picker.js")]: `
    export async function pickPolicyInteractive() {
      globalThis.calls.push(["pick"]);
      return "fixture-policy";
    }
  `,
};
const loader = dataUrl(`
  const mocks = ${JSON.stringify(mocks)};
  export async function resolve(specifier, context, nextResolve) {
    const resolved = await nextResolve(specifier, context);
    if (Object.hasOwn(mocks, resolved.url)) {
      return { url: "data:text/javascript," + encodeURIComponent(mocks[resolved.url]), shortCircuit: true };
    }
    return resolved;
  }
`);
const setup = dataUrl(`import { register } from "node:module"; register(${JSON.stringify(loader)}, import.meta.url);`);

function run(expiresArgs = [], { wallet = true, policy = true } = {}) {
  const argv = ["--name", "fixture-bot"];
  if (wallet) argv.push("--wallet", "fixture-wallet");
  if (policy) argv.push("--policy", "fixture-policy");
  argv.push(...expiresArgs);
  const result = spawnSync(process.execPath, ["--import", setup, "--input-type=module", "-e", `
    import command from ${JSON.stringify(commandUrl)};
    import { parseFlags } from ${JSON.stringify(flagsUrl)};
    globalThis.calls = [];
    process.on("exit", () => process.stderr.write("\\nCALLS:" + JSON.stringify(globalThis.calls)));
    Date.now = () => ${NOW};
    const { rest, flags } = parseFlags(${JSON.stringify(argv)});
    await command(rest, flags);
  `], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  const [stderr, calls] = result.stderr.split("\nCALLS:");
  assert.ok(calls, result.stderr);
  return { status: result.status, stdout: result.stdout, stderr, calls: JSON.parse(calls) };
}

describe("agent create-token expiry", () => {
  for (const [input, expected] of [
    ["24h", "2026-09-23T10:35:59.329Z"],
    ["7d", "2026-09-29T10:35:59.329Z"],
    ["2H", "2026-09-22T12:35:59.329Z"],
    ["2099-06-01", "2099-06-01T00:00:00.000Z"],
    ["2028-02-29", "2028-02-29T00:00:00.000Z"],
    ["2099-06-01T12:30:00+02:00", "2099-06-01T10:30:00.000Z"],
    ["2099-06-01T10:35:59.329Z", "2099-06-01T10:35:59.329Z"],
    ["2099-06-01t12:00:00z", "2099-06-01T12:00:00.000Z"],
    ["0h", "2026-09-22T10:35:59.329Z"],
    ["2020-01-01", "2020-01-01T00:00:00.000Z"],
  ]) {
    it(`passes ${input} to OWS and reports it as the same ISO timestamp`, () => {
      const result = run(["--expires", input]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.calls.find(([kind]) => kind === "create")[4], expected);
      assert.equal(JSON.parse(result.stdout).agentToken.expiresAt, expected);
    });
  }

  it("preserves omitted expiry", () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.find(([kind]) => kind === "create")[4], null);
    assert.equal(JSON.parse(result.stdout).agentToken.expiresAt, "never");
  });

  for (const args of [
    ["--expires"], ["--no-expires"], ["--expires="],
    ["--expires", "nonsense"], ["--expires", "1.5h"],
    ["--expires", "2099-02-30"], ["--expires", "2099-06-01T12:00:00"],
    ["--expires", "0000-01-01T00:00:00+01:00"],
    ["--expires", "999999999999999999999999999999d"],
    ["--expires", "99999999d"],
  ]) {
    it(`rejects ${args.join(" ")} before reading state or a passphrase`, () => {
      const result = run(args, { policy: false });
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stderr).error.code, "invalid_expires");
      assert.equal(result.stdout, "");
      assert.deepEqual(result.calls, []);
    });
  }

  it("validates expiry before looking up the default wallet", () => {
    const result = run(["--expires"], { wallet: false, policy: false });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).error.code, "invalid_expires");
    assert.deepEqual(result.calls, []);
  });
});
