/**
 * Solana glue for the web-app signing handoff.
 *
 * The web-app handoff (utils/web-app/handoff.js) is chain-agnostic: it forms the
 * link and runs the callback listener, but delegates on-chain hash checks and
 * signature verification to an injected `client`. This module supplies the
 * Solana side of that contract:
 *
 *   - buildUnsignedSolanaTransfer — a native SOL transfer serialized to the
 *     base64 unsigned tx the /cli/transaction link carries (no signing).
 *   - solanaReceiptAdapter        — a `client`-shaped object whose
 *     getTransactionReceipt maps a returned signature to a success/reverted
 *     verdict (the Solana analogue of viem's receipt check).
 *   - solanaMessageVerifier       — a `client`-shaped object whose verifyMessage
 *     checks an ed25519 signature against the signer pubkey (the Solana analogue
 *     of viem's verifyMessage), so signMessageViaWebApp can trust-but-verify.
 *
 * Local signing/broadcast lives in solana.js / solana-send.js; the handoff path
 * never touches key material.
 */

import { Buffer } from "node:buffer";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getSolanaRpcUrl } from "./registry.js";
import { solToLamports, lamportsToSol } from "./solana-send.js";

let _connection;
export function getSolanaConnection() {
  if (!_connection) {
    _connection = new Connection(getSolanaRpcUrl(), "confirmed");
  }
  return _connection;
}

/**
 * Build a native SOL transfer as a base64 unsigned VersionedTransaction — the
 * exact `raw` the /cli/transaction link carries for Solana. Mirrors the build
 * in solana-send.js but stops before signing: the connected wallet in the
 * browser signs and broadcasts. Gates on balance (amount + fee) first so a
 * doomed transfer fails here, before the browser opens.
 *
 * @param {object} params
 * @param {string} params.from - sender base58 pubkey (the link's signer)
 * @param {string} params.to - recipient base58 pubkey
 * @param {string|number} params.amountSol - amount in SOL (human-readable)
 * @returns {Promise<{ raw: string }>} base64 unsigned tx (signature slot zeroed)
 */
export async function buildUnsignedSolanaTransfer({ from, to, amountSol }) {
  const connection = getSolanaConnection();
  const fromPk = new PublicKey(from);
  const toPk = new PublicKey(to);

  const lamports = solToLamports(String(amountSol));

  const balance = BigInt(await connection.getBalance(fromPk));
  const fee = 5_000n; // 5000 lamports per signature; native transfers have one
  if (balance < lamports + fee) {
    const err = new Error(
      `Insufficient SOL: have ${lamportsToSol(balance)}, need ${amountSol} + ~${lamportsToSol(fee)} fee`
    );
    err.code = "insufficient_balance";
    throw err;
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: fromPk,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: fromPk,
        toPubkey: toPk,
        lamports: Number(lamports),
      }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  // v0 serialize leaves the signature slot zero-filled — exactly the placeholder
  // layout the web app (and the local signer) expect.
  const raw = Buffer.from(tx.serialize()).toString("base64");
  return { raw };
}

/**
 * A viem-`client`-shaped adapter whose getTransactionReceipt lets the shared
 * verifyHashes step confirm a Solana signature on-chain (trust-but-verify,
 * ADR-0002). Throwing when the signature isn't visible yet drives verifyHashes'
 * built-in retry; a landed-with-error status maps to `reverted`.
 */
export function solanaReceiptAdapter(connection = getSolanaConnection()) {
  return {
    async getTransactionReceipt({ hash }) {
      const { value } = await connection.getSignatureStatuses([hash], {
        searchTransactionHistory: true,
      });
      const status = value?.[0];
      if (!status) {
        // Not yet visible — let verifyHashes retry, then degrade to a warning.
        throw new Error(`signature ${hash} not found yet`);
      }
      return { status: status.err ? "reverted" : "success" };
    },
  };
}

/**
 * A viem-`client`-shaped adapter whose verifyMessage checks a Solana ed25519
 * signature against the signer pubkey — the Solana analogue of viem's
 * verifyMessage, called by signMessageViaWebApp's verifySignature for
 * `solanaMessage` requests. Best-effort: if the crypto lib can't load or the
 * signature can't be decoded, returns null (unverified) so the handoff degrades
 * to warn-and-accept rather than a false failure.
 */
export function solanaMessageVerifier() {
  return {
    async verifyMessage({ address, message, signature }) {
      let ed25519;
      try {
        ({ ed25519 } = await import("@noble/curves/ed25519"));
      } catch {
        return null; // crypto lib unavailable — caller degrades to unverified
      }
      const messageBytes = hexToBytes(message.raw);
      const sigBytes = decodeSignature(signature);
      if (!sigBytes || sigBytes.length !== 64) return null;
      const pubkeyBytes = new PublicKey(address).toBytes();
      try {
        return ed25519.verify(sigBytes, messageBytes, pubkeyBytes);
      } catch {
        return false;
      }
    },
  };
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

// Solana wallets return signatures in a few encodings; accept the common ones.
// 0x-hex → hex; otherwise try base58 (the Solana convention) then base64.
// Returns null if nothing yields a plausible 64-byte signature.
function decodeSignature(signature) {
  if (typeof signature !== "string" || signature.length === 0) return null;
  if (signature.startsWith("0x")) {
    return Uint8Array.from(Buffer.from(signature.slice(2), "hex"));
  }
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(signature)) {
    const b58 = base58Decode(signature);
    if (b58 && b58.length === 64) return b58;
  }
  const b64 = Buffer.from(signature, "base64");
  return b64.length ? Uint8Array.from(b64) : null;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str) {
  let bytes = [0];
  for (const ch of str) {
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // leading '1's are leading zero bytes
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}
