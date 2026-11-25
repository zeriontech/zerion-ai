// Safe wallets hold no key material, and their per-chain cache is display-only, never trusted for signing.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getAddress, isAddress } from "viem";
import { CONFIG_DIR } from "../common/constants.js";

const SAFE_PATH = `${CONFIG_DIR}/safe-wallets.json`;

/**
 * @typedef {{ chainId:number, version:"1.3.0"|"1.4.1"|"1.5.0", threshold:number, owners:string[],
 *   txService:string|null, appPrefix:string|null, refreshedAt:string }} SafeChainCache
 * @typedef {{ name:string, address:string, signers:string[], executor:string|null,
 *   chains: Record<string, SafeChainCache>, createdAt:string, updatedAt?:string }} SafeEntry
 */

function load() {
  if (!existsSync(SAFE_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(SAFE_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SAFE_PATH, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
}

export function addSafe({ name, address, signers, executor = null, chains = {} }) {
  if (!isAddress(address, { strict: false })) {
    throw new Error(`Safe wallets need a 0x EVM address; got "${address}"`);
  }
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new Error(`Safe wallet "${name}" needs at least one signer`);
  }
  const fields = { address: getAddress(address), signers: [...signers], executor: executor ?? null, chains };
  const entries = load();
  const existing = entries.find((e) => e.name === name);
  if (existing) {
    Object.assign(existing, fields, { updatedAt: new Date().toISOString() });
  } else {
    entries.push({ name, ...fields, createdAt: new Date().toISOString() });
  }
  save(entries);
}

export function removeSafe(name) {
  const entries = load();
  const idx = entries.findIndex((e) => e.name === name);
  if (idx === -1) throw new Error(`"${name}" is not a Safe wallet`);
  entries.splice(idx, 1);
  save(entries);
}

export function listSafes() {
  return load();
}

export function getSafe(name) {
  return load().find((e) => e.name === name) || null;
}

export function isSafeWallet(name) {
  return getSafe(name) != null;
}

export function isSafeAddress(address) {
  if (typeof address !== "string") return false;
  const wanted = address.toLowerCase();
  return load().some((e) => e.address.toLowerCase() === wanted);
}

export function safeUnsupportedCommandError(name, command) {
  const err = new Error(`"${name}" is a Safe wallet, and \`zerion ${command}\` does not support Safe wallets.`);
  err.code = "safe_unsupported_command";
  err.suggestion = "Use a keystore or read-only wallet for this command.";
  return err;
}
