// Hardcoded fallback list of Umbra-supported mints. STALE BY DESIGN —
// devnet redeploys + mainnet additions happen out-of-band. Use this only
// for offline dev and as a last-resort fallback.
//
// AUTHORITATIVE source at runtime: `relayer.getSupportedMints()` —
// see fetchLiveSupportedMints() below. The relayer's list is filtered
// to mints with deployed token-pool + fee-schedule PDAs, so it doubles as
// a "pool deployed" check (pitfalls.md §13: error 3012 = pool missing).
//
// Critical rule 9: verify the mint is supported BEFORE building any tx.

import type { IUmbraRelayer } from "@umbra-privacy/sdk/interfaces";

export interface SupportedMint {
  mint: string;
  symbol: string;
  decimals: number;
  network: "mainnet-beta" | "devnet";
}

export const FALLBACK_MINTS: readonly SupportedMint[] = [
  // Mainnet
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, network: "mainnet-beta" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, network: "mainnet-beta" },
  { mint: "So11111111111111111111111111111111111111112",  symbol: "wSOL", decimals: 9, network: "mainnet-beta" },
  // Devnet — only dUSDC and dUSDT have deployed pools. Faucet:
  // https://faucet.umbraprivacy.com/. Always confirm with
  // relayer.getSupportedMints() before relying on this list.
  { mint: "4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7", symbol: "dUSDC", decimals: 6, network: "devnet" },
  { mint: "DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6", symbol: "dUSDT", decimals: 6, network: "devnet" },
];

export const SUPPORTED_MINTS = FALLBACK_MINTS;

export function isSupportedMint(mint: string, network: "mainnet-beta" | "devnet"): boolean {
  return SUPPORTED_MINTS.some((m) => m.mint === mint && m.network === network);
}

export function findMint(mint: string, network: "mainnet-beta" | "devnet"): SupportedMint | undefined {
  return SUPPORTED_MINTS.find((m) => m.mint === mint && m.network === network);
}

// Authoritative runtime check: ask the relayer for its currently-deployed
// supported mints. This is the source of truth — the hardcoded list above
// is just an offline fallback. Call once at app boot, cache for the session.
export async function fetchLiveSupportedMints(relayer: IUmbraRelayer): Promise<Set<string>> {
  const response = (await relayer.getSupportedMints()) as unknown as {
    mints?: ReadonlyMap<string, unknown> | readonly string[] | Record<string, unknown>;
  };
  const set = new Set<string>();
  const m = response.mints;
  if (m instanceof Map) {
    for (const k of m.keys()) set.add(String(k));
  } else if (Array.isArray(m)) {
    for (const v of m) set.add(String(v));
  } else if (m && typeof m === "object") {
    for (const k of Object.keys(m)) set.add(k);
  }
  return set;
}
