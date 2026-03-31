/**
 * OWS wrapper — abstracts @open-wallet-standard/core for EVM + Solana usage.
 * Zerion CLI never touches raw key material; OWS handles all crypto.
 */

import * as ows from "@open-wallet-standard/core";

function extractEvmAddress(wallet) {
  const evmAccount = wallet.accounts.find((a) =>
    a.chainId.startsWith("eip155:")
  );
  if (!evmAccount) {
    throw new Error(`Wallet "${wallet.name}" has no EVM account`);
  }
  return evmAccount.address;
}

function extractSolAddress(wallet) {
  const solAccount = wallet.accounts.find((a) =>
    a.chainId.startsWith("solana:")
  );
  return solAccount ? solAccount.address : null;
}

function formatWallet(wallet) {
  return {
    name: wallet.name,
    id: wallet.id,
    evmAddress: extractEvmAddress(wallet),
    solAddress: extractSolAddress(wallet),
    chains: wallet.accounts.map((a) => a.chainId),
    createdAt: wallet.createdAt,
  };
}

export function createWallet(name, passphrase) {
  const wallet = ows.createWallet(name, passphrase);
  return formatWallet(wallet);
}

export function importFromMnemonic(name, mnemonic, passphrase) {
  const wallet = ows.importWalletMnemonic(name, mnemonic, passphrase);
  return formatWallet(wallet);
}

export function importFromKey(name, privateKeyHex, passphrase) {
  // Ensure 0x prefix is stripped if present — OWS expects raw hex
  const key = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const wallet = ows.importWalletPrivateKey(
    name,
    key,
    passphrase,
    undefined,
    "evm"
  );
  return formatWallet(wallet);
}

export function listWallets() {
  return ows.listWallets().map(formatWallet);
}

export function getWallet(nameOrId) {
  return formatWallet(ows.getWallet(nameOrId));
}

export function getEvmAddress(walletName) {
  return extractEvmAddress(ows.getWallet(walletName));
}

export function getSolAddress(walletName) {
  return extractSolAddress(ows.getWallet(walletName));
}

export function deleteWallet(nameOrId) {
  ows.deleteWallet(nameOrId);
}

export function exportWallet(nameOrId, passphrase) {
  return ows.exportWallet(nameOrId, passphrase);
}

// --- Agent API Keys ---

export function createAgentToken(name, walletName, passphrase, expiresAt, policyIds = []) {
  const wallet = ows.getWallet(walletName);
  const result = ows.createApiKey(name, [wallet.id], policyIds, passphrase, expiresAt || undefined);
  return {
    token: result.token,
    id: result.id,
    name: result.name,
    wallet: walletName,
    walletId: wallet.id,
  };
}

export function listAgentTokens() {
  return ows.listApiKeys().map((k) => ({
    id: k.id,
    name: k.name,
    walletIds: k.wallet_ids,
    policyIds: k.policy_ids,
    expiresAt: k.expires_at,
    createdAt: k.created_at,
  }));
}

export function revokeAgentToken(idOrName) {
  // Try by ID first, then search by name
  try {
    ows.revokeApiKey(idOrName);
    return;
  } catch (err) {
    if (!err.message?.includes("not found")) throw err;
    const keys = ows.listApiKeys();
    const found = keys.find((k) => k.name === idOrName);
    if (!found) throw new Error(`Agent token "${idOrName}" not found`);
    ows.revokeApiKey(found.id);
  }
}

/**
 * Get the agent token from environment (for unattended agent signing).
 * Returns the token string or null if not set.
 * OWS validates the token at signing time — if revoked, signing will fail.
 */
export function getAgentToken() {
  return process.env.ZERION_AGENT_TOKEN || null;
}

/**
 * Sign an EVM transaction.
 * @param {string} walletName
 * @param {string} unsignedTxHex - Serialized unsigned EIP-1559 tx (0x-prefixed)
 * @param {string} [passphrase]
 * @returns {{ signature: string, recoveryId: number }}
 *   signature: 128 hex chars (r: 64 + s: 64)
 *   recoveryId: 0 or 1 (maps to yParity for EIP-1559)
 */
export function signEvmTransaction(walletName, unsignedTxHex, passphrase) {
  return ows.signTransaction(walletName, "evm", unsignedTxHex, passphrase);
}

export function signSolanaTransaction(walletName, txHex, passphrase) {
  return ows.signTransaction(walletName, "solana", txHex, passphrase);
}

// --- Policies ---
// CAIP-2 mapping is derived from chains.js (single source of truth)
import { SUPPORTED_CHAINS, toCaip2, fromCaip2 } from "../chain/registry.js";
export { toCaip2, fromCaip2 };

export function allChainNames() {
  return SUPPORTED_CHAINS;
}

export function createPolicy(id, name, rules, executable, config) {
  const policy = {
    id,
    name,
    version: 1,
    created_at: new Date().toISOString(),
    action: "deny",
    rules: rules || [],
    executable: executable || null,
    config: config || null,
  };
  ows.createPolicy(JSON.stringify(policy));
  return policy;
}

export function listPolicies() {
  return ows.listPolicies().map((p) =>
    typeof p === "string" ? JSON.parse(p) : p
  );
}

export function getPolicy(id) {
  const p = ows.getPolicy(id);
  return typeof p === "string" ? JSON.parse(p) : p;
}

export function deletePolicy(id) {
  ows.deletePolicy(id);
}
