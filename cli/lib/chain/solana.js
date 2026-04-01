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
 * The Zerion API returns transaction data as a hex-encoded serialized
 * Solana transaction. We deserialize it, sign with OWS, and broadcast.
 */
export async function signAndBroadcastSolana(swapTxData, walletName, passphrase) {
  const connection = getConnection();

  // The Zerion swap API returns Solana tx as hex in the transaction.data field
  const txData = swapTxData.data;
  if (!txData) {
    throw new Error("No transaction data from swap API for Solana");
  }

  // Decode the transaction — try VersionedTransaction first, fall back to legacy
  const txBuffer = Buffer.from(txData.startsWith("0x") ? txData.slice(2) : txData, "hex");

  let signedTxBytes;

  try {
    // Sign with OWS — pass the raw tx bytes as hex for OWS to sign
    const signResult = ows.signSolanaTransaction(walletName, txData, passphrase);

    // OWS returns the fully signed transaction
    signedTxBytes = Buffer.from(signResult.signature, "hex");
  } catch (err) {
    throw new Error(`Failed to sign Solana transaction: ${err.message}`);
  }

  // Broadcast
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
