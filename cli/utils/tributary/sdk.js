import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";
import { Buffer } from "node:buffer";
import { getSolanaRpcUrl } from "../chain/registry.js";
import * as ows from "../wallet/keystore.js";

let _connection;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(getSolanaRpcUrl(), "confirmed");
  }
  return _connection;
}

export async function getTributarySdk(walletPubkey) {
  const connection = getConnection();
  const pubkey = new PublicKey(walletPubkey);

  const walletAdapter = {
    publicKey: pubkey,
    signTransaction: async () => {
      throw new Error(
        "Direct signing not supported — use sendTributaryInstructions",
      );
    },
    signAllTransactions: async () => {
      throw new Error(
        "Direct signing not supported — use sendTributaryInstructions",
      );
    },
  };

  const sdk = new Tributary(connection, walletAdapter);

  return {
    program: sdk.program,
    programId: sdk.programId,
    connection,
    walletPubkey: pubkey,

    async createSubscription(
      tokenMint,
      recipient,
      gateway,
      amount,
      autoRenew,
      maxRenewals,
      frequency,
      memo,
    ) {
      return sdk.createSubscription(
        tokenMint,
        recipient,
        gateway,
        amount,
        autoRenew,
        maxRenewals,
        frequency,
        memo,
      );
    },

    async getPaymentPoliciesByUserPayment(userPaymentPda) {
      return sdk.getPaymentPoliciesByUserPayment(userPaymentPda);
    },

    async getPaymentPolicy(policyPda) {
      return sdk.getPaymentPolicy(policyPda);
    },

    getUserPaymentPda(owner, tokenMint) {
      return sdk.getUserPaymentPda(owner, tokenMint);
    },

    getPaymentPolicyPda(userPaymentPda, policyId) {
      return sdk.getPaymentPolicyPda(userPaymentPda, policyId);
    },

    async changePaymentPolicyStatus(tokenMint, policyId, status) {
      const ix = await sdk.changePaymentPolicyStatus(
        tokenMint,
        policyId,
        status,
      );
      return [ix];
    },

    async deletePaymentPolicy(tokenMint, policyId) {
      const ix = await sdk.deletePaymentPolicy(tokenMint, policyId);
      return [ix];
    },
  };
}

export async function getTributarySdkReadOnly(walletPubkey) {
  return getTributarySdk(walletPubkey);
}

export async function sendTributaryInstructions(
  instructions,
  payerKey,
  walletName,
  passphrase,
) {
  const connection = getConnection();
  const payer = new PublicKey(payerKey);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const rawWithPlaceholder = Buffer.from(tx.serialize());

  const signRes = ows.signSolanaTransaction(
    walletName,
    rawWithPlaceholder.toString("hex"),
    passphrase,
  );
  const signatureBytes = Buffer.from(signRes.signature, "hex");

  if (signatureBytes.length !== 64) {
    throw new Error(
      `Unexpected Solana signature length: ${signatureBytes.length}`,
    );
  }

  const sigCount = rawWithPlaceholder[0];
  if (sigCount !== 1) {
    throw new Error(
      `Unsupported tx with ${sigCount} signatures (only single-signer supported)`,
    );
  }

  const messageBytes = rawWithPlaceholder.subarray(1 + 64);
  const signedTxBytes = Buffer.concat([
    Buffer.from([1]),
    signatureBytes,
    messageBytes,
  ]);

  process.stderr.write("Broadcasting Tributary transaction...\n");
  const hash = await connection.sendRawTransaction(signedTxBytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  process.stderr.write(`Tx hash: ${hash}\nWaiting for confirmation...\n`);
  await connection.confirmTransaction(
    { signature: hash, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return { hash, status: "confirmed" };
}
