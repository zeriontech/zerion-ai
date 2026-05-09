/**
 * Solana send — builds, signs, broadcasts a native SOL transfer.
 *
 * Mirrors the swap flow in solana.js: builds the unsigned message, lets OWS
 * sign over it, then splices the 64-byte signature into the placeholder slot
 * to produce a valid VersionedTransaction.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { getSolanaRpcUrl } from "./registry.js";
import * as ows from "../wallet/keystore.js";

const LAMPORTS_PER_SOL = 1_000_000_000n;

let _connection;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(getSolanaRpcUrl(), "confirmed");
  }
  return _connection;
}

/**
 * Send native SOL.
 * @param {object} params
 * @param {string} params.from - sender base58 pubkey
 * @param {string} params.to - recipient base58 pubkey
 * @param {string|number} params.amountSol - amount in SOL (human-readable)
 * @param {string} params.walletName
 * @param {string} params.passphrase
 * @returns {Promise<{ hash: string, status: "success", chain: "solana" }>}
 */
export async function sendSolanaNative({ from, to, amountSol, walletName, passphrase }) {
  const connection = getConnection();
  const fromPk = new PublicKey(from);
  const toPk = new PublicKey(to);

  // Convert SOL → lamports without floating-point loss.
  const lamports = solToLamports(String(amountSol));

  // Sanity: enough lamports + rent buffer? Read balance.
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
  // Reserve the signature slot (web3.js uses zero-filled by default for v0).
  const rawWithPlaceholder = Buffer.from(tx.serialize());

  // OWS expects the full raw tx (with placeholder zero signatures) so it can
  // parse the message and sign the right bytes. It returns just the 64-byte
  // ed25519 signature.
  const signRes = ows.signSolanaTransaction(walletName, rawWithPlaceholder.toString("hex"), passphrase);
  const signatureBytes = Buffer.from(signRes.signature, "hex");
  if (signatureBytes.length !== 64) {
    throw new Error(`Unexpected Solana signature length: ${signatureBytes.length}`);
  }

  // Splice signature into slot 0.
  const sigCount = rawWithPlaceholder[0];
  if (sigCount !== 1) {
    throw new Error(`Unsupported tx with ${sigCount} signatures (only single-signer supported)`);
  }
  const messageBytes = rawWithPlaceholder.subarray(1 + 64);
  const signedTxBytes = Buffer.concat([Buffer.from([1]), signatureBytes, messageBytes]);

  process.stderr.write("Broadcasting Solana transaction...\n");
  const hash = await connection.sendRawTransaction(signedTxBytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  process.stderr.write(`Tx hash: ${hash}\nWaiting for confirmation...\n`);
  await connection.confirmTransaction({ signature: hash, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight }, "confirmed");

  return { hash, status: "success", chain: "solana" };
}

function solToLamports(amountStr) {
  const [whole, frac = ""] = amountStr.split(".");
  const padded = (frac + "000000000").slice(0, 9);
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(padded || "0");
}

function lamportsToSol(lamports) {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
