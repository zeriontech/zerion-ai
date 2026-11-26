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
import { encodeFunctionData, hashTypedData, parseAbi, serializeTransaction } from "viem";
import { withDecodedSafeExecution, withDecodedSafeTx, withDecodedTransaction } from "#zerion/policies/decode.mjs";

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

// Public Safe 1.3.0 execution on Ethereum (USDC transfer, nonce 302), safeTxHash
// 0x4ed44c58…baef; cases below vary its message.
const SAFE = "0x87cc0d34f6111c8A7A4Bdf758a9a715A3675f941";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SAFE_DOMAIN = { chainId: 1, verifyingContract: SAFE };
const SAFE_TX_TYPES = {
  EIP712Domain: [
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};
const VECTOR_MESSAGE = {
  to: USDC,
  value: "0",
  data: "0xa9059cbb000000000000000000000000420b7a32ae9294372786ed5120ad9feb6bd991280000000000000000000000000000000000000000000000000000000077359400",
  operation: 0,
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: 302,
};
const safeTxJson = (message = {}) =>
  JSON.stringify({
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    domain: SAFE_DOMAIN,
    message: { ...VECTOR_MESSAGE, ...message },
  });

// What OWS 1.3.2 writes to the policy's stdin for typed data: no transaction
// fields, and the JSON it signs verbatim in `raw_json`.
const owsTypedContext = (primaryType, rawJson, verifyingContract, policyConfig) => ({
  chain_id: "eip155:1",
  transaction: { raw_hex: "" },
  typed_data: {
    primary_type: primaryType,
    raw_json: rawJson,
    domain_chain_id: 1,
    verifying_contract: verifyingContract,
  },
  policy_config: policyConfig,
});
const safeTxContext = (rawJson, policyConfig = { scripts: [] }) =>
  owsTypedContext("SafeTx", rawJson, SAFE, policyConfig);

const script = (name) => join(POLICIES_DIR, `${name}.mjs`);
const dispatch = (ctx) => {
  const child = spawnSync(process.execPath, [DISPATCHER], { input: JSON.stringify(ctx), encoding: "utf8" });
  return JSON.parse(child.stdout);
};
const approveCalldata = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [OTHER, 1n] });

// The same vector's message, sent as the raw transaction an owner broadcasts,
// signed with a pre-validated (v=1) owner signature.
const SAFE_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function approveHash(bytes32 hashToApprove)",
]);
const PRE_APPROVED = `0x${ALLOWED.slice(2).padStart(64, "0")}${"0".repeat(64)}01`;
const execCalldata = (message = {}) => {
  const m = { ...VECTOR_MESSAGE, ...message };
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [m.to, BigInt(m.value), m.data, m.operation, BigInt(m.safeTxGas), BigInt(m.baseGas), BigInt(m.gasPrice), m.gasToken, m.refundReceiver, PRE_APPROVED],
  });
};
const approveHashCalldata = encodeFunctionData({
  abi: SAFE_ABI,
  functionName: "approveHash",
  args: ["0x4ed44c58aca5627d11064962a41fb34a7910f4fb9db0f4f2c2144eebc840baef"],
});
const withWord = (calldata, index, word) => {
  const start = 10 + index * 64;
  return calldata.slice(0, start) + word + calldata.slice(start + 64);
};
const execContext = (calldata, policyConfig = { scripts: [] }, tx = {}) =>
  owsContext({ to: SAFE, data: calldata, ...tx }, { policy_config: policyConfig });

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

describe("withDecodedSafeTx", () => {
  it("uses the public Safe 1.3.0 execution as its fixture", () => {
    const hash = hashTypedData({ ...JSON.parse(safeTxJson()), primaryType: "SafeTx" });
    assert.equal(hash, "0x4ed44c58aca5627d11064962a41fb34a7910f4fb9db0f4f2c2144eebc840baef");
  });

  it("fills in to, value and data from the SafeTx message", () => {
    const ctx = safeTxContext(safeTxJson());
    assert.deepEqual(withDecodedSafeTx(ctx), {
      ctx: {
        ...ctx,
        transaction: { raw_hex: "", to: USDC, value: "0", data: VECTOR_MESSAGE.data },
      },
    });
  });

  it("leaves other typed data and other requests unchanged", () => {
    for (const ctx of [
      owsTypedContext("Order", JSON.stringify({ primaryType: "Order" }), ALLOWED, { scripts: [] }),
      owsContext({ to: ALLOWED, value: 5n }),
      { chain_id: "eip155:1", transaction: { raw_hex: "68656c6c6f" } },
      {},
    ]) {
      assert.equal(withDecodedSafeTx(ctx).ctx, ctx);
    }
  });
});

describe("run-policies dispatcher on a SafeTx", () => {
  it("allowlist: allows an allowlisted to and denies any other", () => {
    const config = { scripts: [script("allowlist")], allowed_addresses: [USDC] };
    assert.deepEqual(dispatch(safeTxContext(safeTxJson(), config)), { allow: true });
    assert.deepEqual(dispatch(safeTxContext(safeTxJson({ to: OTHER }), config)), {
      allow: false,
      reason: `Recipient ${OTHER} is not in the allowlist. Only known DEX routers are permitted.`,
    });
  });

  it("deny-transfers: denies native value with empty data and allows a token call", () => {
    const config = { scripts: [script("deny-transfers")] };
    assert.deepEqual(dispatch(safeTxContext(safeTxJson(), config)), { allow: true });
    assert.deepEqual(dispatch(safeTxContext(safeTxJson({ to: OTHER, value: "1000000000000000000", data: "0x" }), config)), {
      allow: false,
      reason: "Raw native transfers are blocked by policy. Only DEX interactions allowed.",
    });
  });

  it("deny-approvals: denies an ERC-20 approve and allows a transfer", () => {
    const config = { scripts: [script("deny-approvals")] };
    assert.deepEqual(dispatch(safeTxContext(safeTxJson(), config)), { allow: true });
    assert.deepEqual(dispatch(safeTxContext(safeTxJson({ data: approveCalldata }), config)), {
      allow: false,
      reason: "ERC-20 approval calls are blocked by policy (selector: 0x095ea7b3).",
    });
  });

  it("denies a SafeTx it cannot read plainly, whatever scripts are configured", () => {
    const withDuplicateTo = (key) =>
      safeTxJson().replace('"message":{', `"message":{"${key}":"${OTHER}",`);
    const cases = [
      ["operation 1", safeTxJson({ operation: 1 }), "operation is not 0"],
      ['operation "1"', safeTxJson({ operation: "1" }), "operation is not 0"],
      ['gasPrice "1"', safeTxJson({ gasPrice: "1" }), "gasPrice is not 0"],
      ["non-zero gasToken", safeTxJson({ gasToken: USDC }), "gasToken is not the zero address"],
      ["non-zero refundReceiver", safeTxJson({ refundReceiver: OTHER }), "refundReceiver is not the zero address"],
      ["missing to", safeTxJson({ to: undefined }), "to is not an address"],
      ["value not numeric", safeTxJson({ value: "1 ether" }), "value is not a non-negative integer"],
      ["data not hex", safeTxJson({ data: "a9059cbb" }), "data is not hex bytes"],
      ["duplicate to in message", withDuplicateTo("to"), 'raw_json repeats the key "to"'],
      ["duplicate to spelled with an escape", withDuplicateTo("t\\u006f"), 'raw_json repeats the key "to"'],
      ["unparseable raw_json", "{", "raw_json does not parse"],
    ];
    assert.deepEqual(dispatch(safeTxContext(safeTxJson())), { allow: true });
    for (const [name, rawJson, why] of cases) {
      assert.deepEqual(
        dispatch(safeTxContext(rawJson)),
        { allow: false, reason: `SafeTx not evaluable by policy: ${why}` },
        name
      );
    }
  });
});

describe("withDecodedSafeExecution", () => {
  it("fills in to, value and data from the execTransaction calldata", () => {
    const ctx = withDecodedTransaction(execContext(execCalldata()));
    assert.deepEqual(withDecodedSafeExecution(ctx), {
      ctx: {
        ...ctx,
        transaction: { ...ctx.transaction, to: USDC, value: "0", data: VECTOR_MESSAGE.data },
      },
    });
  });

  it("leaves other transactions and requests unchanged", () => {
    for (const ctx of [
      withDecodedTransaction(owsContext({ to: SAFE, data: `0x6a761203${execCalldata().slice(10)}` })),
      withDecodedTransaction(owsContext({ to: SAFE, value: 1n })),
      withDecodedTransaction(owsContext({ data: execCalldata() })),
      withDecodedTransaction(execContext(approveHashCalldata, { scripts: [script("deny-approvals")] })),
      safeTxContext(safeTxJson()),
      { chain_id: "eip155:1", transaction: { raw_hex: "68656c6c6f" } },
      {},
    ]) {
      assert.equal(withDecodedSafeExecution(ctx).ctx, ctx);
    }
  });
});

describe("run-policies dispatcher on a raw execTransaction", () => {
  it("deny-transfers: denies an inner native transfer and allows an inner ERC-20 transfer or other call", () => {
    const config = { scripts: [script("deny-transfers")] };
    assert.deepEqual(dispatch(execContext(execCalldata({ to: OTHER, value: "1000000000000000000", data: "0x" }), config)), {
      allow: false,
      reason: "Raw native transfers are blocked by policy. Only DEX interactions allowed.",
    });
    assert.deepEqual(dispatch(execContext(execCalldata(), config)), { allow: true });
    assert.deepEqual(dispatch(execContext(execCalldata({ to: OTHER, data: "0xabcdef01" }), config)), { allow: true });
  });

  it("allowlist: judges the inner recipient, not the Safe", () => {
    const innerListed = { scripts: [script("allowlist")], allowed_addresses: [ALLOWED] };
    const safeListed = { scripts: [script("allowlist")], allowed_addresses: [SAFE] };
    assert.deepEqual(dispatch(execContext(execCalldata({ to: ALLOWED }), innerListed)), { allow: true });
    assert.deepEqual(dispatch(execContext(execCalldata({ to: OTHER }), safeListed)), {
      allow: false,
      reason: `Recipient ${OTHER} is not in the allowlist. Only known DEX routers are permitted.`,
    });
  });

  it("deny-approvals: denies an inner ERC-20 approve", () => {
    const config = { scripts: [script("deny-approvals")] };
    assert.deepEqual(dispatch(execContext(execCalldata({ data: approveCalldata }), config)), {
      allow: false,
      reason: "ERC-20 approval calls are blocked by policy (selector: 0x095ea7b3).",
    });
  });

  it("denies an execTransaction it cannot read plainly, whatever scripts are configured", () => {
    const valid = execCalldata();
    const word = (n) => n.toString(16).padStart(64, "0");
    const cases = [
      ["operation 1", execCalldata({ operation: 1 }), {}, "operation is not 0"],
      ["safeTxGas set", execCalldata({ safeTxGas: "1" }), {}, "safeTxGas is not 0"],
      ["baseGas set", execCalldata({ baseGas: "1" }), {}, "baseGas is not 0"],
      ["gasPrice set", execCalldata({ gasPrice: "1" }), {}, "gasPrice is not 0"],
      ["non-zero gasToken", execCalldata({ gasToken: USDC }), {}, "gasToken is not the zero address"],
      ["non-zero refundReceiver", execCalldata({ refundReceiver: OTHER }), {}, "refundReceiver is not the zero address"],
      ["operation word out of uint8 range", withWord(valid, 3, word(256)), {}, "execTransaction calldata is not canonically encoded"],
      ["data offset past the calldata", withWord(valid, 2, "f".repeat(64)), {}, "execTransaction calldata does not decode"],
      ["truncated calldata", valid.slice(0, 200), {}, "execTransaction calldata does not decode"],
      ["selector only", "0x6a761202", {}, "execTransaction calldata does not decode"],
      ["to word with dirty high bits", withWord(valid, 0, "ff".repeat(12) + USDC.slice(2).toLowerCase()), {}, "execTransaction calldata is not canonically encoded"],
      ["trailing bytes", `${valid}00`, {}, "execTransaction calldata is not canonically encoded"],
      ["outer value", valid, { value: 1n }, "execTransaction is sent with a non-zero value"],
      ["inner execTransaction", execCalldata({ to: OTHER, data: valid }), {}, "the inner call is itself execTransaction or approveHash"],
      ["inner approveHash", execCalldata({ to: OTHER, data: approveHashCalldata }), {}, "the inner call is itself execTransaction or approveHash"],
    ];
    assert.deepEqual(dispatch(execContext(valid)), { allow: true });
    for (const [name, calldata, tx, why] of cases) {
      for (const config of [{ scripts: [] }, { scripts: [script("deny-approvals")] }]) {
        assert.deepEqual(
          dispatch(execContext(calldata, config, tx)),
          { allow: false, reason: `SafeTx not evaluable by policy: ${why}` },
          name
        );
      }
    }
  });
});

describe("run-policies dispatcher on a raw approveHash", () => {
  const denial = { allow: false, reason: "SafeTx not evaluable by policy: approveHash commits to a call the policy cannot see" };

  it("denies under deny-transfers and under allowlist, even with the Safe listed", () => {
    assert.deepEqual(dispatch(execContext(approveHashCalldata, { scripts: [script("deny-transfers")] })), denial);
    assert.deepEqual(dispatch(execContext(approveHashCalldata, { scripts: [script("allowlist")], allowed_addresses: [SAFE] })), denial);
    assert.deepEqual(
      dispatch(execContext(approveHashCalldata, { scripts: [script("deny-approvals"), script("deny-transfers")] })),
      denial
    );
  });

  it("keeps the deny-approvals-only decision", () => {
    assert.deepEqual(dispatch(execContext(approveHashCalldata, { scripts: [script("deny-approvals")] })), { allow: true });
  });
});

// Decisions recorded from origin/main's dispatcher for the same contexts.
describe("run-policies dispatcher outside SafeTx", () => {
  const permit = JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: { name: "USD Coin", version: "2", chainId: 1, verifyingContract: USDC },
    message: { owner: ALLOWED, spender: OTHER, value: "1000000", nonce: 0, deadline: "1893456000" },
  });
  const configs = {
    allowlist: { scripts: [script("allowlist")], allowed_addresses: [ALLOWED] },
    "deny-transfers": { scripts: [script("deny-transfers")] },
    "deny-approvals": { scripts: [script("deny-approvals")] },
  };
  const contexts = {
    "Permit typed data": (config) => owsTypedContext("Permit", permit, USDC, config),
    "plain transaction": (config) => owsContext({ to: OTHER, value: 1n }, { policy_config: config }),
    "message, no transaction fields": (config) => ({
      chain_id: "eip155:1",
      transaction: { raw_hex: "68656c6c6f" },
      policy_config: config,
    }),
  };
  const noRecipient = { allow: false, reason: "Transaction has no recipient address." };
  const expected = {
    "Permit typed data": { allowlist: noRecipient, "deny-transfers": { allow: true }, "deny-approvals": { allow: true } },
    "plain transaction": {
      allowlist: { allow: false, reason: `Recipient ${OTHER} is not in the allowlist. Only known DEX routers are permitted.` },
      "deny-transfers": { allow: false, reason: "Raw native transfers are blocked by policy. Only DEX interactions allowed." },
      "deny-approvals": { allow: true },
    },
    "message, no transaction fields": { allowlist: noRecipient, "deny-transfers": { allow: true }, "deny-approvals": { allow: true } },
  };

  for (const [contextName, build] of Object.entries(contexts)) {
    it(`${contextName}: same decision under each script as before`, () => {
      for (const [scriptName, config] of Object.entries(configs)) {
        assert.deepEqual(dispatch(build(config)), expected[contextName][scriptName], scriptName);
      }
    });
  }
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

  const signSafeTx = (token, message) => ows.signTypedData(WALLET, safeTxJson(message), token, "eip155:1");

  it("allowlist: signs a SafeTx whose call goes to an allowlisted address and denies any other", () => {
    signed(signSafeTx(tokens.allowlist, { to: ALLOWED }));
    denied(() => signSafeTx(tokens.allowlist, { to: OTHER }), /Recipient 0x0+b2 is not in the allowlist/);
  });

  it("deny-transfers: denies a SafeTx moving native value", () => {
    signed(signSafeTx(tokens.denyTransfers, {}));
    denied(
      () => signSafeTx(tokens.denyTransfers, { to: OTHER, value: "1000000000000000000", data: "0x" }),
      /Raw native transfers are blocked/
    );
  });

  it("deny-transfers: denies a raw execTransaction whose inner call moves native value", () => {
    denied(
      () => sign(tokens.denyTransfers, { to: SAFE, data: execCalldata({ to: OTHER, value: "1000000000000000000", data: "0x" }) }),
      /Raw native transfers are blocked/
    );
  });

  it("allowlist: signs a raw execTransaction whose inner call goes to the only allowlisted address", () => {
    signed(sign(tokens.allowlist, { to: SAFE, data: execCalldata({ to: ALLOWED, value: "1", data: "0x" }) }));
  });
});
