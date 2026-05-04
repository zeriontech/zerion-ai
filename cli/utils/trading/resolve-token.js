/**
 * Token resolver — maps human input ("ETH", "USDC", "0xA0b8...") to Zerion fungible IDs.
 */

import * as api from "../api/client.js";
import { NATIVE_ASSET_ADDRESS } from "../common/constants.js";
import { rerankByRelevance } from "./rank-fungibles.js";
import { getNativeFungible } from "../chain/catalog.js";

// Hardcoded aliases for the most common tokens — avoids API call for basic swaps
const NATIVE_ALIASES = new Map([
  ["ETH", { fungibleId: "eth", symbol: "ETH", decimals: 18, address: NATIVE_ASSET_ADDRESS }],
  ["SOL", { fungibleId: "11111111111111111111111111111111", symbol: "SOL", decimals: 9, address: "So11111111111111111111111111111111111111112" }],
  ["WETH", { fungibleId: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 }],
  ["USDC", { fungibleId: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 }],
  ["USDT", { fungibleId: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 }],
  ["DAI", { fungibleId: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18 }],
  ["WBTC", { fungibleId: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8 }],
]);

/**
 * Resolve a token query to a Zerion-compatible fungible reference.
 * @param {string} query - Token name, symbol, or contract address
 * @param {string} [chainId] - Optional chain filter
 * @returns {Promise<{ fungibleId: string, symbol: string, decimals: number, name?: string, address?: string }>}
 */
export async function resolveToken(query, chainId) {
  const upper = query.toUpperCase();

  // 1a. Match the chain's native currency before checking the static alias
  // table — chains like Monad/BNB/Avalanche have native symbols not in
  // NATIVE_ALIASES, and their native fungible is what users mean when they
  // type the symbol with --chain set.
  if (chainId) {
    try {
      const native = await getNativeFungible(chainId);
      if (native && native.symbol && native.symbol.toUpperCase() === upper) {
        return {
          fungibleId: native.fungibleId,
          symbol: native.symbol,
          name: native.name || native.symbol,
          decimals: native.decimals ?? 18,
          address: NATIVE_ASSET_ADDRESS,
        };
      }
    } catch {
      // fall through — native lookup is best-effort, the search path can
      // still resolve the query if the catalog call is rate-limited
    }
  }

  // 1b. Check native aliases (ETH, USDC, …)
  if (NATIVE_ALIASES.has(upper)) {
    return { ...NATIVE_ALIASES.get(upper), name: upper };
  }

  // 2. If it looks like a contract address, resolve decimals from API
  if (query.startsWith("0x") && query.length >= 40) {
    const addr = query.toLowerCase();
    // Try to get actual decimals from chain-specific implementation
    try {
      const response = await api.searchFungibles(addr, { chainId, limit: 1 });
      const match = response.data?.[0];
      if (match) {
        const impl = (match.attributes?.implementations || []).find(
          (i) => i.chain_id === chainId
        ) || match.attributes?.implementations?.[0];
        return {
          fungibleId: match.id,
          symbol: match.attributes?.symbol || addr.slice(0, 6) + "...",
          decimals: impl?.decimals ?? 18,
          address: impl?.address || addr,
          name: match.attributes?.name || "Unknown",
        };
      }
    } catch { /* fall through to default */ }
    return {
      fungibleId: addr,
      symbol: addr.slice(0, 6) + "...",
      decimals: 18,
      address: addr,
      name: "Unknown",
    };
  }

  // 3. Search via Zerion Fungibles API. Pull a larger pool than we need so
  // the local relevance rerank has something to work with — the API sorts by
  // market cap, which buries exact-symbol matches under unrelated big-cap
  // tokens that happen to share a substring.
  const response = await api.searchFungibles(query, { chainId, limit: 50 });
  const results = response.data || [];

  if (results.length === 0) {
    const err = new Error(`Could not resolve token "${query}"`);
    err.code = "invalid_token";
    err.suggestion = `Try: zerion search ${query}`;
    throw err;
  }

  // Prefer the chain-specific match when a chainId was provided.
  const ranked = rerankByRelevance(results, query);
  const onChain = chainId
    ? ranked.find((r) =>
        (r.attributes?.implementations || []).some((i) => i.chain_id === chainId)
      )
    : null;
  const best = onChain || ranked[0];

  const impl =
    (chainId &&
      (best.attributes?.implementations || []).find((i) => i.chain_id === chainId)) ||
    best.attributes?.implementations?.[0];

  return {
    fungibleId: best.id,
    symbol: best.attributes?.symbol,
    name: best.attributes?.name,
    decimals: impl?.decimals ?? 18,
    address: impl?.address,
  };
}
