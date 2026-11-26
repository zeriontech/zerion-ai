/**
 * The wallet library (OWS) runs a policy when it signs and hands it the
 * transaction as raw bytes in `transaction.raw_hex`. The policy scripts read
 * `transaction.to` / `value` / `data`. This fills those in from the bytes for
 * an EVM transaction, so the scripts rule on the transaction being signed.
 *
 * Every other request — a message, typed data, a Solana transaction, bytes
 * that are not a transaction — is returned unchanged.
 *
 * Safe typed data (a SafeTx) is the exception: withDecodedSafeTx fills in the
 * call the Safe will execute, read from the JSON OWS signs. For a transaction
 * calling a Safe's `execTransaction`, withDecodedSafeExecution does the same
 * from the calldata.
 */

import { decodeFunctionData, encodeFunctionData, isAddress, isHex, parseAbi, parseTransaction, zeroAddress } from "viem";

const EXEC_TRANSACTION = "0x6a761202";
const APPROVE_HASH = "0xd4d9bdcd";
const SAFE_EXEC_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);
const SCRIPTS_DENYING_APPROVE_HASH = new Set(["deny-transfers.mjs", "allowlist.mjs"]);

/**
 * @param {object} ctx - PolicyContext from OWS
 * @returns {object} the context, with the EVM transaction's fields decoded
 */
export function withDecodedTransaction(ctx) {
  const rawHex = ctx?.transaction?.raw_hex;
  if (typeof rawHex !== "string" || rawHex === "") return ctx;
  if (!String(ctx.chain_id || "").startsWith("eip155:")) return ctx;
  // OWS 1.4+ says what kind of request this is. Earlier versions do not, so
  // there the bytes decide: they either parse as a transaction or they don't.
  if (ctx.request_type && ctx.request_type !== "sign_transaction") return ctx;

  let tx;
  try {
    tx = parseTransaction(rawHex.startsWith("0x") ? rawHex : `0x${rawHex}`);
  } catch {
    return ctx;
  }
  return {
    ...ctx,
    transaction: {
      ...ctx.transaction,
      to: tx.to ?? null,
      value: (tx.value ?? 0n).toString(),
      data: tx.data ?? "0x",
    },
  };
}

/**
 * Any SafeTx whose call cannot be read plainly (delegatecall, gas refund,
 * ill-typed or repeated fields) is denied rather than evaluated.
 *
 * @param {object} ctx - PolicyContext from OWS
 * @returns {{ ctx: object } | { denial: { allow: false, reason: string } }}
 */
export function withDecodedSafeTx(ctx) {
  if (ctx?.typed_data?.primary_type !== "SafeTx") return { ctx };

  const { call, problem } = readSafeTxCall(ctx.typed_data.raw_json);
  if (problem) return notEvaluable(problem);
  return { ctx: { ...ctx, transaction: { ...ctx.transaction, ...call } } };
}

/**
 * A transaction calling `execTransaction` is judged by the call the Safe will
 * execute; one that cannot be read plainly is denied, and so is `approveHash`
 * under a policy that judges recipients or value.
 *
 * @param {object} ctx - PolicyContext, after withDecodedTransaction
 * @returns {{ ctx: object } | { denial: { allow: false, reason: string } }}
 */
export function withDecodedSafeExecution(ctx) {
  const selector = callSelector(ctx?.transaction);
  if (selector === APPROVE_HASH) {
    return judgesRecipientOrValue(ctx.policy_config)
      ? notEvaluable("approveHash commits to a call the policy cannot see")
      : { ctx };
  }
  if (selector !== EXEC_TRANSACTION) return { ctx };

  const { call, problem } = readExecTransactionCall(ctx.transaction);
  if (problem) return notEvaluable(problem);
  const innerSelector = callSelector(call);
  if (innerSelector === EXEC_TRANSACTION || innerSelector === APPROVE_HASH) {
    return notEvaluable("the inner call is itself execTransaction or approveHash");
  }
  return { ctx: { ...ctx, transaction: { ...ctx.transaction, ...call } } };
}

function notEvaluable(problem) {
  return { denial: { allow: false, reason: `SafeTx not evaluable by policy: ${problem}` } };
}

function callSelector(tx) {
  if (!tx?.to || typeof tx.data !== "string") return null;
  return tx.data.slice(0, 10).toLowerCase();
}

function judgesRecipientOrValue(policyConfig) {
  const scripts = Array.isArray(policyConfig?.scripts) ? policyConfig.scripts : [];
  return scripts.some((script) => SCRIPTS_DENYING_APPROVE_HASH.has(String(script).split(/[\\/]/).pop()));
}

function readExecTransactionCall(tx) {
  if (!isZeroUint(tx.value)) return { problem: "execTransaction is sent with a non-zero value" };
  let args;
  try {
    ({ args } = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: tx.data }));
  } catch {
    return { problem: "execTransaction calldata does not decode" };
  }
  if (reencodedExecTransaction(args) !== tx.data.toLowerCase()) {
    return { problem: "execTransaction calldata is not canonically encoded" };
  }
  const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver] = args;
  const problem =
    executionProblem({ operation, gasPrice, gasToken, refundReceiver }) ??
    (isZeroUint(safeTxGas) ? null : "safeTxGas is not 0") ??
    (isZeroUint(baseGas) ? null : "baseGas is not 0");
  if (problem) return { problem };
  return { call: { to, value: value.toString(), data } };
}

function reencodedExecTransaction(args) {
  try {
    return encodeFunctionData({ abi: SAFE_EXEC_ABI, functionName: "execTransaction", args });
  } catch {
    return null;
  }
}

function executionProblem({ operation, gasPrice, gasToken, refundReceiver }) {
  if (!isZeroUint(operation)) return "operation is not 0";
  if (!isZeroUint(gasPrice)) return "gasPrice is not 0";
  if (!isZeroAddress(gasToken)) return "gasToken is not the zero address";
  if (!isZeroAddress(refundReceiver)) return "refundReceiver is not the zero address";
  return null;
}

function readSafeTxCall(rawJson) {
  if (typeof rawJson !== "string") return { problem: "raw_json is not a string" };
  let typed;
  try {
    typed = JSON.parse(rawJson);
  } catch {
    return { problem: "raw_json does not parse" };
  }
  if (typed?.primaryType !== "SafeTx") return { problem: "primaryType is not SafeTx" };
  const message = typed.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return { problem: "message is not an object" };
  }
  const repeated = firstRepeatedKey(rawJson);
  if (repeated !== null) return { problem: `raw_json repeats the key "${repeated}"` };

  const problem = executionProblem(message);
  if (problem) return { problem };
  if (typeof message.to !== "string" || !isAddress(message.to, { strict: false })) {
    return { problem: "to is not an address" };
  }
  if (!isUint(message.value)) return { problem: "value is not a non-negative integer" };
  if (!isHex(message.data) || message.data.length % 2 !== 0) {
    return { problem: "data is not hex bytes" };
  }
  return { call: { to: message.to, value: String(message.value), data: message.data } };
}

function isUint(value) {
  if (typeof value === "bigint") return value >= 0n;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

function isZeroUint(value) {
  return isUint(value) && BigInt(value) === 0n;
}

function isZeroAddress(value) {
  return typeof value === "string" && value.toLowerCase() === zeroAddress;
}

// Expects JSON that JSON.parse has already accepted.
function firstRepeatedKey(json) {
  const scopes = [];
  let keyNext = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === "{") {
      scopes.push(new Set());
      keyNext = true;
    } else if (c === "[") {
      scopes.push(null);
      keyNext = false;
    } else if (c === "}" || c === "]") {
      scopes.pop();
      keyNext = false;
    } else if (c === ",") {
      keyNext = scopes.at(-1) instanceof Set;
    } else if (c === '"') {
      let end = i + 1;
      while (json[end] !== '"') end += json[end] === "\\" ? 2 : 1;
      if (keyNext) {
        const key = JSON.parse(json.slice(i, end + 1));
        if (scopes.at(-1).has(key)) return key;
        scopes.at(-1).add(key);
        keyNext = false;
      }
      i = end;
    }
  }
  return null;
}
