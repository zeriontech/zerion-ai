// Unit coverage for the prepared-group envelope: buildPreparedGroup shape +
// defaults, and parsePreparedGroup validation of untrusted `--group` stdin.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PREPARED_GROUP_KIND,
  buildPreparedGroup,
  parsePreparedGroup,
} from "#zerion/utils/web-app/prepared-group.js";

const EVM_TX = { evm: { to: "0xabc", value: "0x0", data: "0x" }, label: "Send 1 USDC" };

describe("buildPreparedGroup", () => {
  it("assembles a well-formed envelope with defaults", () => {
    const env = buildPreparedGroup({
      ecosystem: "evm",
      chain: "base",
      address: "0xSigner",
      walletName: "main",
      route: "web-app",
      summary: { send: { token: "USDC" } },
      transactions: [EVM_TX],
    });
    assert.equal(env.kind, PREPARED_GROUP_KIND);
    assert.equal(env.version, 1);
    assert.equal(env.ecosystem, "evm");
    assert.equal(env.chain, "base");
    assert.equal(env.route, "web-app");
    assert.deepEqual(env.transactions, [EVM_TX]);
    assert.deepEqual(env.outflows, []);
    assert.ok(env.preparedAt, "defaults preparedAt to now");
    assert.ok(!Number.isNaN(Date.parse(env.preparedAt)));
  });

  it("rejects an invalid ecosystem / empty transactions", () => {
    assert.throws(() => buildPreparedGroup({ ecosystem: "btc", chain: "base", address: "0x", transactions: [EVM_TX] }), /ecosystem/);
    assert.throws(() => buildPreparedGroup({ ecosystem: "evm", chain: "base", address: "0x", transactions: [] }), /non-empty/);
  });
});

describe("parsePreparedGroup", () => {
  const valid = JSON.stringify(buildPreparedGroup({
    ecosystem: "evm",
    chain: "base",
    address: "0xSigner",
    walletName: "main",
    route: "local",
    summary: {},
    transactions: [EVM_TX],
    preparedAt: "2026-07-22T00:00:00.000Z",
  }));

  it("round-trips a valid envelope", () => {
    const parsed = parsePreparedGroup(valid, 0);
    assert.equal(parsed.kind, PREPARED_GROUP_KIND);
    assert.equal(parsed.address, "0xSigner");
    assert.equal(parsed.transactions.length, 1);
  });

  it("rejects non-JSON", () => {
    assert.throws(() => parsePreparedGroup("not json", 0), /valid JSON/);
  });

  it("rejects stray JSON that isn't a prepared group", () => {
    assert.throws(() => parsePreparedGroup(JSON.stringify({ foo: 1 }), 1), /prepared-group envelope/);
  });

  it("rejects a bad ecosystem / missing address / missing chain", () => {
    const noAddr = JSON.stringify({ kind: PREPARED_GROUP_KIND, ecosystem: "evm", chain: "base", transactions: [EVM_TX] });
    assert.throws(() => parsePreparedGroup(noAddr), /signer address/);
    const badEco = JSON.stringify({ kind: PREPARED_GROUP_KIND, ecosystem: "x", chain: "base", address: "0x", transactions: [EVM_TX] });
    assert.throws(() => parsePreparedGroup(badEco), /ecosystem/);
  });

  it("rejects empty or malformed transaction entries", () => {
    const empty = JSON.stringify({ kind: PREPARED_GROUP_KIND, ecosystem: "evm", chain: "base", address: "0x", transactions: [] });
    assert.throws(() => parsePreparedGroup(empty), /no transactions/);
    const noPayload = JSON.stringify({ kind: PREPARED_GROUP_KIND, ecosystem: "evm", chain: "base", address: "0x", transactions: [{ label: "x" }] });
    assert.throws(() => parsePreparedGroup(noPayload), /without an evm\/solana/);
  });

  it("carries the group index into the error message", () => {
    assert.throws(() => parsePreparedGroup("bad", 2), /group #3/);
  });
});
