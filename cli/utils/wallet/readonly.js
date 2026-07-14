/**
 * Read-only ("my wallet, no secret") registry.
 *
 * A read-only wallet is a first-class saved wallet the CLI can build
 * transactions for and read on-chain, but holds NO key material — just a name
 * and an address. Transaction and message signing always route to the web-app
 * handoff (the human connects a wallet controlling that address in the browser).
 *
 * Stored separately from both the OWS keystore (which holds encrypted keys) and
 * the watchlist (tracking-only addresses that are never "my wallet"), at
 * ~/.zerion/readonly-wallets.json.
 *
 * Supports both ecosystems: a 0x EVM address or a base58 Solana pubkey. The
 * address format determines which chains the wallet can sign for — an EVM
 * read-only wallet can't be used with --chain solana, and vice versa.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { CONFIG_DIR } from "../common/constants.js";

const READONLY_PATH = `${CONFIG_DIR}/readonly-wallets.json`;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

function load() {
  if (!existsSync(READONLY_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(READONLY_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(READONLY_PATH, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Add (or update) a read-only wallet. `address` must already be a resolved
 * 0x EVM address (ENS is resolved once, upstream, at add time) or a base58
 * Solana pubkey.
 */
export function addReadonly(name, address) {
  if (!EVM_ADDR_RE.test(address) && !SOL_ADDR_RE.test(address)) {
    throw new Error(`Read-only wallets need a 0x EVM address or a base58 Solana pubkey; got "${address}"`);
  }
  const entries = load();
  const existing = entries.find((e) => e.name === name);
  if (existing) {
    existing.address = address;
    existing.updatedAt = new Date().toISOString();
  } else {
    entries.push({ name, address, createdAt: new Date().toISOString() });
  }
  save(entries);
}

export function removeReadonly(name) {
  const entries = load();
  const idx = entries.findIndex((e) => e.name === name);
  if (idx === -1) throw new Error(`"${name}" is not a read-only wallet`);
  entries.splice(idx, 1);
  save(entries);
}

export function listReadonly() {
  return load();
}

/**
 * Look up a read-only wallet by name. Returns the entry or null.
 */
export function getReadonly(name) {
  return load().find((e) => e.name === name) || null;
}

/**
 * Whether `name` refers to a read-only wallet. Signing for these always routes
 * to the web-app handoff; key-requiring commands must refuse.
 */
export function isReadonlyWallet(name) {
  return getReadonly(name) != null;
}
