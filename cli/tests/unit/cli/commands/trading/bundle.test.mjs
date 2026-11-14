// `zerion bundle` on the local route must refuse — before anything is signed —
// an envelope whose `walletName` doesn't own its signer `address`. The key is
// looked up by name and `--group` blobs are untrusted, so without the check a
// mismatched envelope signed from a different wallet than the one it named.
//
// Runs the real CLI in a subprocess against a temp HOME (so neither ~/.zerion
// nor ~/.ows is touched). Every case here ends before any network call.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));
const OTHER = "0x9999990000000000000000000000000000000009";

let tmpHome;
let owned; // address of the keystore wallet "b-own"
const origHome = process.env.HOME;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-bundle-"));
  process.env.HOME = tmpHome;
  const ows = await import("#zerion/utils/wallet/keystore.js");
  owned = ows.createWallet("b-own", "pass").evmAddress;
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

const envelope = (over = {}) => JSON.stringify({
  kind: "zerion-prepared-group",
  version: 1,
  ecosystem: "evm",
  chain: "ethereum",
  address: owned,
  walletName: "b-own",
  route: "local",
  summary: {},
  outflows: [],
  transactions: [{ label: "Protocol call", evm: {
    type: "0x2", from: owned, to: "0x00000000000000000000000000000000000000c3",
    chainId: "0x1", gas: "0x5208", value: "0x0", data: "0x",
  } }],
  ...over,
});

function bundle(...groups) {
  const args = [BIN, "bundle", ...groups.flatMap((g) => ["--group", g])];
  const env = { ...process.env, HOME: tmpHome, ZERION_API_KEY: "zk_dev_unit_test" };
  delete env.ZERION_AGENT_TOKEN;
  return new Promise((resolve) => {
    execFile("node", args, { env }, (error, stdout, stderr) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stderr.slice(stderr.indexOf("{"))).error;
      } catch {
        // leave null — the assertion below reports the raw stderr
      }
      resolve({ code: error?.code ?? 0, stdout, stderr, error: parsed });
    });
  });
}

describe("zerion bundle — local-route signer check", () => {
  it("rejects a walletName that does not own the signer address", async () => {
    const res = await bundle(envelope({ address: OTHER }));
    assert.equal(res.code, 1, res.stderr);
    assert.equal(res.error?.code, "wallet_address_mismatch", res.stderr);
    assert.equal(res.stdout, "");
  });

  it("rejects a walletName that is not in the keystore, pointing at the web-app route", async () => {
    const res = await bundle(envelope({ walletName: "some-read-only-wallet" }));
    assert.equal(res.code, 1, res.stderr);
    assert.equal(res.error?.code, "wallet_not_found", res.stderr);
    assert.match(res.error.suggestion, /"route":"web-app"/);
  });

  it("lets a matching envelope through to the agent-token check for that wallet", async () => {
    // Same address in a different case still matches. With no token saved the
    // run stops at the next gate, which now names the signing wallet.
    const res = await bundle(envelope({ address: owned.toLowerCase() }));
    assert.equal(res.code, 1, res.stderr);
    assert.equal(res.error?.code, "no_agent_token", res.stderr);
    assert.match(res.error.message, /wallet "b-own" has none/);
    assert.match(res.stderr, /Bundle route: local/);
  });
});
