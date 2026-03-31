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
import { getViemChain } from "../chain/registry.js";
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

  // Get nonce and gas prices from chain
  const [nonce, feeData] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);

  // Parse values from Zerion API response (may be hex strings or numbers)
  const chainId = swapTx.chain_id
    ? parseInt(swapTx.chain_id, 16) || getViemChain(zerionChainId).id
    : getViemChain(zerionChainId).id;

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

  // Serialize unsigned
  const unsignedTxHex = serializeTransaction(tx);

  // Sign with OWS
  const signResult = ows.signEvmTransaction(walletName, unsignedTxHex, passphrase);

  // Reconstruct signed tx
  const sigHex = signResult.signature;
  const r = `0x${sigHex.slice(0, 64)}`;
  const s = `0x${sigHex.slice(64, 128)}`;
  const yParity = signResult.recoveryId;

  const signedTxHex = serializeTransaction(tx, { r, s, yParity });

  return { signedTxHex, client, tx };
}

/**
 * Broadcast a signed transaction and wait for receipt.
 */
export async function broadcastAndWait(client, signedTxHex) {
  const hash = await client.sendRawTransaction({
    serializedTransaction: signedTxHex,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  return {
    hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
  };
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
  } catch {
    gasEstimate = 100000n; // Safe fallback
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

  const unsignedTxHex = serializeTransaction(tx);
  const signResult = ows.signEvmTransaction(walletName, unsignedTxHex, passphrase);

  const sigHex = signResult.signature;
  const r = `0x${sigHex.slice(0, 64)}`;
  const s = `0x${sigHex.slice(64, 128)}`;
  const yParity = signResult.recoveryId;

  const signedTxHex = serializeTransaction(tx, { r, s, yParity });
  return broadcastAndWait(client, signedTxHex);
}
