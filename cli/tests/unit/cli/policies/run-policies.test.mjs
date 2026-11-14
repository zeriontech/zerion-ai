// Executable policies as the wallet library (OWS) runs them: at signing time,
// in a child process, with the transaction as raw bytes. The policy scripts
// read `transaction.to` / `value` / `data`, which OWS never sends, so a token
// with an allowlist could not sign anything — not even a transaction to an
// allowlisted address. The dispatcher now decodes the bytes first.
//
// The signing tests go through real OWS. They use a temp HOME so neither
// ~/.zerion nor ~/.ows is touched (CONFIG_DIR is derived from HOME at import
// time, so HOME must be set before the imports).

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, serializeTransaction } from "viem";
import { withDecodedTransaction } from "#zerion/policies/decode.mjs";

const POLICIES_DIR = dirname(fileURLToPath(import.meta.resolve("#zerion/policies/allowlist.mjs")));
const DISPATCHER = join(POLICIES_DIR, "run-policies.mjs");
const ALLOWED = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const evmTx = (tx) =>
  serializeTransaction({
    type: "eip1559",
    chainId: 1,
    nonce: 0,
    gas: 100000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    ...tx,
  });

// What OWS writes to the policy's stdin for a transaction. 1.4+ names the
// request type; earlier versions send the same context without it.
const owsContext = (tx, extra = {}) => ({
  chain_id: "eip155:1",
  request_type: "sign_transaction",
  transaction: { raw_hex: evmTx(tx).slice(2) },
  ...extra,
});

describe("withDecodedTransaction", () => {
  it("fills in to, value and data from the raw bytes", () => {
    const ctx = owsContext({ to: ALLOWED, value: 5n, data: "0x095ea7b3" }, { policy_config: { scripts: [] } });
    const decoded = withDecodedTransaction(ctx);
    assert.deepEqual(decoded.transaction, {
      raw_hex: ctx.transaction.raw_hex,
      to: ALLOWED,
      value: "5",
      data: "0x095ea7b3",
    });
    assert.deepEqual(decoded.policy_config, { scripts: [] });
  });

  it("decodes when OWS sends no request type (before 1.4)", () => {
    const { request_type: _omit, ...ctx } = owsContext({ to: ALLOWED, value: 5n });
    const decoded = withDecodedTransaction(ctx);
    assert.equal(decoded.transaction.to, ALLOWED);
    assert.equal(decoded.transaction.value, "5");
    assert.equal(decoded.transaction.data, "0x");
  });

  it("reports a contract creation as having no recipient", () => {
    assert.equal(withDecodedTransaction(owsContext({ data: "0x6000" })).transaction.to, null);
  });

  it("leaves every other request unchanged", () => {
    const tx = evmTx({ to: ALLOWED, value: 5n }).slice(2);
    for (const ctx of [
      { chain_id: "eip155:1", request_type: "sign_message", transaction: { raw_hex: tx } },
      { chain_id: "eip155:1", request_type: "sign_hash", transaction: { raw_hex: "11".repeat(32) } },
      { chain_id: "eip155:1", request_type: "sign_typed_data", typed_data: { raw_json: "{}" } },
      { chain_id: "eip155:1", transaction: { raw_hex: "" }, typed_data: { raw_json: "{}" } },
      { chain_id: "eip155:1", transaction: { raw_hex: "68656c6c6f" } }, // not a transaction
      { chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", request_type: "sign_transaction", transaction: { raw_hex: tx } },
      {},
    ]) {
      assert.deepEqual(withDecodedTransaction(ctx), ctx);
    }
  });
});

describe("run-policies dispatcher", () => {
  // OWS waits for the process to exit and gives up after 5s. A timer left
  // pending used to hold every run open for 4s.
  it("exits as soon as the scripts have answered", () => {
    const ctx = owsContext(
      { to: OTHER, data: "0xabcdef01" },
      { policy_config: { scripts: [join(POLICIES_DIR, "deny-transfers.mjs")] } }
    );
    const started = Date.now();
    const child = spawnSync(process.execPath, [DISPATCHER], { input: JSON.stringify(ctx), encoding: "utf8" });
    const ms = Date.now() - started;
    assert.deepEqual(JSON.parse(child.stdout), { allow: true });
    assert.ok(ms < 3000, `dispatcher took ${ms}ms`);
  });
});

describe("policies at the OWS layer", () => {
  const WALLET = "p-wallet";
  const PASSPHRASE = "pass";
  let ows;
  let tmpHome;
  const tokens = {};
  const origHome = process.env.HOME;
  const origEnvToken = process.env.ZERION_AGENT_TOKEN;

  // Built the way `agent create-policy` builds them: the dispatcher as the
  // executable, the rule scripts in its config.
  function tokenWithPolicy(id, scripts, extraConfig = {}) {
    ows.createPolicy(id, id, [], DISPATCHER, {
      scripts: scripts.map((s) => join(POLICIES_DIR, `${s}.mjs`)),
      ...extraConfig,
    });
    return ows.createAgentToken(`token-${id}`, WALLET, PASSPHRASE, undefined, [id]).token;
  }

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "zerion-policies-"));
    process.env.HOME = tmpHome;
    delete process.env.ZERION_AGENT_TOKEN;
    ows = await import("#zerion/utils/wallet/keystore.js");
    ows.createWallet(WALLET, PASSPHRASE);
    tokens.allowlist = tokenWithPolicy("allowlist", ["allowlist"], { allowed_addresses: [ALLOWED] });
    tokens.denyTransfers = tokenWithPolicy("deny-transfers", ["deny-transfers"]);
    tokens.denyApprovals = tokenWithPolicy("deny-approvals", ["deny-approvals"]);
  });

  after(() => {
    process.env.HOME = origHome;
    if (origEnvToken === undefined) delete process.env.ZERION_AGENT_TOKEN;
    else process.env.ZERION_AGENT_TOKEN = origEnvToken;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const sign = (token, tx) => ows.signEvmTransaction(WALLET, evmTx(tx), token, "eip155:1");
  const signed = (result) => assert.match(result.signature, /^[0-9a-f]{128}/);
  const denied = (fn, reason) =>
    assert.throws(fn, (err) => {
      assert.match(err.message, /^policy denied: /);
      assert.match(err.message, reason);
      return true;
    });
  const typedData = JSON.stringify({
    domain: { name: "App", chainId: 1, verifyingContract: ALLOWED },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Order: [{ name: "maker", type: "address" }],
    },
    primaryType: "Order",
    message: { maker: OTHER },
  });

  it("allowlist: signs a transaction to an allowlisted address", () => {
    signed(sign(tokens.allowlist, { to: ALLOWED, value: 1n }));
    signed(sign(tokens.allowlist, { to: ALLOWED, data: "0xabcdef01" }));
  });

  it("allowlist: denies a transaction to any other address", () => {
    denied(() => sign(tokens.allowlist, { to: OTHER, value: 1n }), /Recipient 0x0+b2 is not in the allowlist/);
    denied(() => sign(tokens.allowlist, { data: "0x6000" }), /no recipient address/);
  });

  it("deny-transfers: denies a raw native transfer and signs a contract call", () => {
    denied(() => sign(tokens.denyTransfers, { to: OTHER, value: 1n }), /Raw native transfers are blocked/);
    signed(sign(tokens.denyTransfers, { to: OTHER, value: 1n, data: "0xabcdef01" }));
  });

  it("deny-approvals: denies an ERC-20 approve and signs other calls", () => {
    const approve = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [OTHER, 1n] });
    const transfer = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [OTHER, 1n] });
    denied(() => sign(tokens.denyApprovals, { to: ALLOWED, data: approve }), /ERC-20 approval calls are blocked/);
    signed(sign(tokens.denyApprovals, { to: ALLOWED, data: transfer }));
  });

  // Not transactions, so nothing is decoded and they behave as before: an
  // allowlist finds no recipient and denies; the deny-* scripts see nothing
  // to object to.
  it("leaves message and typed-data signing as it was", () => {
    denied(() => ows.signMessage(WALLET, "hello", tokens.allowlist, "utf8", "eip155:1"), /no recipient address/);
    denied(() => ows.signTypedData(WALLET, typedData, tokens.allowlist, "eip155:1"), /no recipient address/);
    signed(ows.signMessage(WALLET, "hello", tokens.denyTransfers, "utf8", "eip155:1"));
    signed(ows.signTypedData(WALLET, typedData, tokens.denyApprovals, "eip155:1"));
  });
});
