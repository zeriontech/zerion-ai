/**
 * The wallet library (OWS) runs a policy when it signs and hands it the
 * transaction as raw bytes in `transaction.raw_hex`. The policy scripts read
 * `transaction.to` / `value` / `data`. This fills those in from the bytes for
 * an EVM transaction, so the scripts rule on the transaction being signed.
 *
 * Every other request — a message, typed data, a Solana transaction, bytes
 * that are not a transaction — is returned unchanged.
 */

import { parseTransaction } from "viem";

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
