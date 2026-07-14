// Unit coverage for the read-only wallet registry: EVM-only enforcement,
// add/update/remove, and lookup. Uses a temp HOME so the real ~/.zerion is
// never touched (CONFIG_DIR is derived from HOME at import time).

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let readonly;
let tmpHome;
const origHome = process.env.HOME;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-ro-"));
  process.env.HOME = tmpHome;
  readonly = await import("#zerion/utils/wallet/readonly.js");
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("read-only registry", () => {
  it("starts empty", () => {
    assert.deepEqual(readonly.listReadonly(), []);
    assert.equal(readonly.isReadonlyWallet("nope"), false);
  });

  it("adds and looks up an EVM wallet", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    readonly.addReadonly("alice", addr);
    assert.equal(readonly.isReadonlyWallet("alice"), true);
    assert.equal(readonly.getReadonly("alice").address, addr);
    assert.equal(readonly.listReadonly().length, 1);
  });

  it("adds and looks up a Solana wallet", () => {
    const sol = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
    readonly.addReadonly("solly", sol);
    assert.equal(readonly.isReadonlyWallet("solly"), true);
    assert.equal(readonly.getReadonly("solly").address, sol);
    readonly.removeReadonly("solly");
  });

  it("rejects addresses that are neither EVM nor Solana", () => {
    assert.throws(() => readonly.addReadonly("bad", "not-an-address"), /0x EVM address or a base58 Solana pubkey/);
  });

  it("updates an existing entry in place (no duplicate)", () => {
    const next = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    readonly.addReadonly("alice", next);
    assert.equal(readonly.getReadonly("alice").address, next);
    assert.equal(readonly.listReadonly().filter((w) => w.name === "alice").length, 1);
  });

  it("removes an entry", () => {
    readonly.removeReadonly("alice");
    assert.equal(readonly.isReadonlyWallet("alice"), false);
    assert.throws(() => readonly.removeReadonly("alice"), /not a read-only wallet/);
  });
});
