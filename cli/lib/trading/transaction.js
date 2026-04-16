/**
 * Transaction helpers — bridge between Zerion API tx objects, viem, and OWS.
 */

import {
  serializeTransaction,
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { getViemChain, toCaip2 } from "../chain/registry.js";
import * as ows from "../wallet/keystore.js";

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/**
 * Get a viem public client for a Zerion chain ID.
 */
export function getPublicClient(zerionChainId) {
  const viemChain = getViemChain(zerionChainId);
  if (!viemChain) throw new Error(`Unsupported chain: ${zerionChainId}`);
  return createPublicClient({ chain: viemChain, transport: http() });
}

/**
 * Build and sign an EVM transaction from Zerion swap API response.
 * @returns {{ signedTxHex: string, txHash: string }}
 */
export async function signSwapTransaction(swapTx, zerionChainId, walletName, passphrase) {
  if (!swapTx) {
    throw new Error("No transaction data from swap API — the quote may require more balance or the pair is unsupported");
  }

  const client = getPublicClient(zerionChainId);
  const walletAddress = ows.getEvmAddress(walletName);

  // Get nonce and gas prices from chain.
  // Use "latest" blockTag for nonce — "pending" can lag on some RPCs after a recent approval tx,
  // causing the swap to reuse the approval's nonce.
  const [nonce, feeData] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: "latest" }),
    client.estimateFeesPerGas(),
  ]);

  // Parse chain ID from Zerion API response — may be hex string ("0x2105"), decimal string ("8453"), or number
  // Always prefer our known chain ID from the --chain flag to avoid mismatches
  const chainId = getViemChain(zerionChainId).id;

  const tx = {
    type: "eip1559",
    chainId,
    to: swapTx.to,
    data: swapTx.data,
    value: BigInt(swapTx.value || "0"),
    gas: BigInt(swapTx.gas || "200000"),
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    nonce,
  };

  const signedTxHex = signAndSerialize(tx, zerionChainId, walletName, passphrase);
  return { signedTxHex, client, tx };
}

/**
 * Sign a transaction object with OWS and return the serialized signed hex.
 * Centralizes the serialize -> sign -> split-signature -> re-serialize pattern.
 */
export function signAndSerialize(tx, zerionChainId, walletName, passphrase) {
  const unsignedTxHex = serializeTransaction(tx);
  const signResult = ows.signEvmTransaction(walletName, unsignedTxHex, passphrase, toCaip2(zerionChainId));

  const sigHex = signResult.signature;
  const r = `0x${sigHex.slice(0, 64)}`;
  const s = `0x${sigHex.slice(64, 128)}`;
  const yParity = signResult.recoveryId;

  return serializeTransaction(tx, { r, s, yParity });
}

/**
 * Broadcast a signed transaction and wait for receipt.
 * @param {object} client - viem public client
 * @param {string} signedTxHex - signed transaction hex
 * @param {object} [options]
 * @param {number} [options.timeout] - timeout in seconds (default 120)
 * @param {boolean} [options.isCrossChain] - if true, print bridge-specific progress
 */
export async function broadcastAndWait(client, signedTxHex, { timeout = 120, isCrossChain = false } = {}) {
  process.stderr.write("Broadcasting transaction...\n");

  let hash;
  try {
    hash = await client.sendRawTransaction({
      serializedTransaction: signedTxHex,
    });
  } catch (err) {
    const error = new Error(
      `Transaction broadcast failed: ${err.message}. ` +
      `Common causes: insufficient gas balance, nonce conflict, or network congestion.`
    );
    error.code = "broadcast_failed";
    throw error;
  }

  process.stderr.write(`Tx hash: ${hash}\n`);
  process.stderr.write("Waiting for confirmation...\n");

  const timeoutMs = timeout * 1000;
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  } catch (err) {
    if (err.name === "TimeoutError" || err.message?.includes("timed out")) {
      const error = new Error(
        `Transaction ${hash} was broadcast but not confirmed within ${timeout}s. ` +
        `It may still confirm — check a block explorer before retrying to avoid double-spend.`
      );
      error.code = "confirmation_timeout";
      error.hash = hash;
      throw error;
    }
    throw err;
  }

  const result = {
    hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
  };

  if (isCrossChain) {
    process.stderr.write("Source chain transaction confirmed.\n");
    result.bridgeStatus = "source_confirmed";
  }

  return result;
}

/**
 * Build and execute an ERC-20 approval transaction.
 * Approves only the exact amount needed (not unlimited).
 */
export async function approveErc20(tokenAddress, spender, amount, zerionChainId, walletName, passphrase) {
  const client = getPublicClient(zerionChainId);
  const walletAddress = ows.getEvmAddress(walletName);

  const [nonce, feeData] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);

  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, amount],
  });

  const chainId = getViemChain(zerionChainId).id;

  // Estimate gas for the approval — don't hardcode, chains vary
  let gasEstimate;
  try {
    gasEstimate = await client.estimateGas({
      account: walletAddress,
      to: tokenAddress,
      data,
      value: 0n,
    });
    // Add 20% buffer
    gasEstimate = (gasEstimate * 120n) / 100n;
  } catch (err) {
    process.stderr.write(`Warning: gas estimation failed, using 100000 fallback: ${err.message}\n`);
    gasEstimate = 100000n;
  }

  const tx = {
    type: "eip1559",
    chainId,
    to: tokenAddress,
    data,
    value: 0n,
    gas: gasEstimate,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    nonce,
  };

  const signedTxHex = signAndSerialize(tx, zerionChainId, walletName, passphrase);
  return broadcastAndWait(client, signedTxHex);
}
