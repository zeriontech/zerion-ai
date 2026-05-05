/**
 * Solana transaction building, signing (via OWS), and RPC broadcast.
 */

import {
  Connection,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import { getSolanaRpcUrl } from "./registry.js";
import * as ows from "../wallet/keystore.js";

let _connection;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(getSolanaRpcUrl(), "confirmed");
  }
  return _connection;
}

/**
 * Sign and broadcast a Solana transaction from the Zerion swap API.
 *
 * The /swap/quotes/ endpoint returns the unsigned tx as base64 in
 * `transaction_swap.solana.raw`. The wire layout is:
 *
 *   [num_signatures: compact-u16][signature_1: 64 bytes]…[signature_N][message]
 *
 * For a single-signer tx the API ships `[0x01][64 zero bytes][message]`. OWS
 * signs over the message bytes and returns just the 64-byte ed25519
 * signature — we splice it into the placeholder slot to assemble the signed
 * transaction.
 */
export async function signAndBroadcastSolana(solanaTx, walletName, passphrase) {
  const connection = getConnection();

  const rawBase64 = solanaTx?.raw;
  if (!rawBase64) {
    throw new Error("No transaction data from swap API for Solana");
  }

  const rawBytes = Buffer.from(rawBase64, "base64");
  const sigCount = rawBytes[0];
  if (sigCount !== 1) {
    throw new Error(
      `Unsupported Solana tx with ${sigCount} signatures — only single-signer txs are supported`
    );
  }
  // OWS expects the full raw tx (with placeholder zero signature) so it can
  // parse the message and sign the right bytes — it then returns just the
  // 64-byte ed25519 signature.
  const rawHex = rawBytes.toString("hex");

  let signatureBytes;
  try {
    const signResult = ows.signSolanaTransaction(walletName, rawHex, passphrase);
    signatureBytes = Buffer.from(signResult.signature, "hex");
  } catch (err) {
    throw new Error(`Failed to sign Solana transaction: ${err.message}`);
  }
  if (signatureBytes.length !== 64) {
    throw new Error(`Unexpected Solana signature length: ${signatureBytes.length}`);
  }

  const messageBytes = rawBytes.subarray(1 + 64);
  const signedTxBytes = Buffer.concat([
    Buffer.from([1]),     // 1 signature
    signatureBytes,       // 64-byte ed25519 sig
    messageBytes,         // unchanged message
  ]);

  const txHash = await sendAndConfirmRawTransaction(connection, signedTxBytes, {
    skipPreflight: false,
    commitment: "confirmed",
  });

  return {
    hash: txHash,
    status: "success",
    chain: "solana",
  };
}
