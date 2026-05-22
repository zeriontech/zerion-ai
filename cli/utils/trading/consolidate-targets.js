/**
 * Consolidate target-token resolution.
 *
 * Symbol-based fuzzy lookup is unreliable: case ("USDC.E" vs "USDC.e"),
 * symbol collisions across unrelated tokens, and bridged variants surface
 * as silent wrong-token resolutions. This module replaces the fuzzy path
 * with two explicit forms:
 *
 *   1. Curated symbol — a short map of canonical Zerion fungible IDs for
 *      tokens users actually consolidate into (USDC, USDT, DAI, WETH,
 *      WBTC, …). The per-chain implementation address is fetched live
 *      from the Zerion API, which guarantees one impl per chain per
 *      fungible. Whichever address Zerion treats as the canonical
 *      implementation of "USDC" on a given chain (Circle-native on some,
 *      bridged USDC.e on others) is what we target.
 *   2. Raw contract address — `0x…` (EVM) or base58 (Solana). The user
 *      takes responsibility for identifying the token.
 *
 * Anything else throws `target_token_not_found` and points the user at
 * the address path.
 */

// Zerion fungible IDs for the most common consolidation targets. One id
// per asset — the per-chain implementation address is resolved at runtime
// from `getFungible(id).attributes.implementations[chain]`. Bridged
// variants like USDC.e are NOT entries here; if Zerion groups one under a
// canonical fungible's per-chain impl, the address-based exclusion picks
// it up automatically.
export const TARGET_FUNGIBLE_IDS = {
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  DAI:  "0x6b175474e89094c44da98b954eedeac495271d0f",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// Solana base58, 32-44 chars. Naive but enough to disambiguate from symbols.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isAddressInput(value, chain) {
  if (!value) return false;
  if (chain === "solana") return SOLANA_ADDRESS_RE.test(value);
  return EVM_ADDRESS_RE.test(value);
}

export function getCuratedFungibleId(symbolUpper) {
  return TARGET_FUNGIBLE_IDS[symbolUpper] || null;
}

export function listCuratedSymbols() {
  return Object.keys(TARGET_FUNGIBLE_IDS).sort();
}

function targetNotFound(toToken, chain) {
  const list = listCuratedSymbols().join(", ");
  const err = new Error(
    `"${toToken}" is not a recognized consolidate target on chain "${chain}". ` +
    `Pass the token contract address, or use one of: ${list}.`,
  );
  err.code = "target_token_not_found";
  err.suggestion = `Find the contract address with: zerion search ${toToken} --chain ${chain}`;
  return err;
}

function pickImplOnChain(fungible, chain) {
  const impls = fungible?.attributes?.implementations || [];
  return impls.find((i) => i?.chain_id === chain) || null;
}

/**
 * Resolve the consolidate target token.
 *
 * Inputs:
 *   toToken            - user-typed symbol or contract address
 *   chain              - validated Zerion chain id
 *   api                - { searchFungibles, getFungible } from utils/api/client
 *   getNativeFungible  - utils/chain/catalog#getNativeFungible
 *
 * Returns:
 *   { symbol, address, usdPrice, fungibleId }
 *     symbol      — upper-case symbol. For curated input we keep the user's
 *                   input ("USDC") rather than the API's `symbol` field, so
 *                   downstream symbol-based exclusion in filterCandidates
 *                   matches what positions actually expose ("USDC", not
 *                   "USD Coin"). For address input we use the API symbol.
 *     address     — lowercased on-chain address on `chain` (the impl Zerion
 *                   returns for this fungible on this chain), or null for
 *                   native. Bridged variants that Zerion groups under a
 *                   canonical fungible are excluded automatically through
 *                   this address.
 *     usdPrice    — Number, may be NaN if market data is missing
 *     fungibleId  — Zerion fungible id
 *
 * Throws an Error with `.code = "target_token_not_found"` when the input is
 * neither curated nor an address, or when the resolved fungible has no
 * implementation on `chain`.
 */
export async function resolveTargetToken({ toToken, chain, api, getNativeFungible }) {
  const raw = String(toToken).trim();
  const upper = raw.toUpperCase();
  const addressLike = isAddressInput(raw, chain);

  // Native gas token — only when the input is a bare symbol and matches the
  // chain's native. `getFungible(id)` for native fungibles isn't reliable
  // (no contract address impl per chain), so route through the catalog.
  if (!addressLike) {
    let native = null;
    try {
      native = await getNativeFungible(chain);
    } catch {
      // catalog failure — fall through; curated/address paths still work
    }
    if (native?.symbol && native.symbol.toUpperCase() === upper) {
      const detail = await api.getFungible(native.fungibleId);
      const attrs = detail?.data?.attributes || {};
      return {
        symbol: native.symbol.toUpperCase(),
        address: null,
        usdPrice: Number(attrs.market_data?.price),
        fungibleId: native.fungibleId,
      };
    }
  }

  // Curated symbol path — fetch the fungible by id, then pick its impl on
  // the target chain. The chain-impl address is the authoritative target
  // for address-based exclusion.
  if (!addressLike) {
    const fungibleId = getCuratedFungibleId(upper);
    if (!fungibleId) throw targetNotFound(toToken, chain);

    const detail = await api.getFungible(fungibleId);
    const fungible = detail?.data;
    const impl = pickImplOnChain(fungible, chain);
    if (!impl?.address) throw targetNotFound(toToken, chain);

    return {
      symbol: upper,
      address: String(impl.address).toLowerCase(),
      usdPrice: Number(fungible?.attributes?.market_data?.price),
      fungibleId,
    };
  }

  // Address path — let the API map the address to a fungible.
  const address = raw.toLowerCase();
  const response = await api.searchFungibles(address, { chainId: chain, limit: 1 });
  const fungible = response.data?.[0];
  if (!fungible) throw targetNotFound(toToken, chain);

  const impl = pickImplOnChain(fungible, chain);
  return {
    symbol: (fungible.attributes?.symbol || upper).toUpperCase(),
    address: impl?.address ? String(impl.address).toLowerCase() : address,
    usdPrice: Number(fungible.attributes?.market_data?.price),
    fungibleId: fungible.id,
  };
}
