/**
 * Address shape helpers — which ecosystem does a raw address string belong to?
 *
 * Deliberately dependency-free (no viem, unlike ./registry.js) so the API
 * client can import it without dragging a chain SDK into every read command.
 *
 * These are *shape* checks, not validity checks: enough to route a request or
 * pick an account, not enough to prove an address exists or is spendable.
 */

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Solana pubkeys are base58 (no 0, O, I, l) and 43–44 chars once encoded.
export const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export function isEvmAddress(value) {
  return typeof value === "string" && EVM_ADDRESS_RE.test(value);
}

export function isSolanaAddress(value) {
  return typeof value === "string" && SOL_ADDRESS_RE.test(value);
}
