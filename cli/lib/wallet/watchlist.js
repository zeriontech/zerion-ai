/**
 * Watchlist storage — track any wallet address with a label.
 * Stored at ~/.zerion-cli/watchlist.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { CONFIG_DIR } from "../util/constants.js";

const WATCHLIST_PATH = `${CONFIG_DIR}/watchlist.json`;

function load() {
  if (!existsSync(WATCHLIST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function save(entries) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(WATCHLIST_PATH, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
}

export function addWatch(name, address) {
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

export function removeWatch(name) {
  const entries = load();
  const idx = entries.findIndex((e) => e.name === name);
  if (idx === -1) throw new Error(`"${name}" not in watchlist`);
  entries.splice(idx, 1);
  save(entries);
}

export function listWatch() {
  return load();
}

export function getWatch(name) {
  const entries = load();
  return entries.find((e) => e.name === name) || null;
}

export function resolveWatchAddress(nameOrAddress) {
  // If it looks like an address, return it directly
  if (/^0x[0-9a-fA-F]{40}$/.test(nameOrAddress) || nameOrAddress.endsWith(".eth")) {
    return nameOrAddress;
  }
  const entry = getWatch(nameOrAddress);
  if (!entry) throw new Error(`"${nameOrAddress}" not in watchlist. Add it: zerion-cli watch <address> --name ${nameOrAddress}`);
  return entry.address;
}
