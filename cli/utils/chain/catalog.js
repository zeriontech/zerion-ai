/**
 * Runtime chain catalog — fetches the live Zerion `/chains/` list and exposes
 * trading-ready configs (chain ID, RPC URLs, viem-compatible chain object) for
 * any chain Zerion supports, not just the ones in the static viem registry.
 *
 * Cached per process. The catalog is a few KB; one fetch covers every command.
 */

import * as api from "../api/client.js";

let catalogPromise = null;

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = api.getChains().then(buildCatalog).catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

function buildCatalog(response) {
  const byId = new Map();
  for (const item of response.data || []) {
    const config = toConfig(item);
    if (config) byId.set(config.id, config);
  }
  return byId;
}

// Chains whose catalog entry has no public RPC a non-browser client can reach.
// Only consulted after every catalog URL has failed, so the catalog always wins
// once chain-storage publishes real endpoints and these entries go cold.
//
// arc: chain-storage lists only `https://rpc.zerion.io/v1/arc`, which is behind
// a Cloudflare managed challenge and 403s anything that isn't a browser, so the
// CLI cannot build a transaction on Arc at all. chainid.network has Arc mainnet
// (5042) with an empty `rpc` array, so the daily chainlist sync has nothing to
// pick up. These are Circle's official public endpoints, from
// https://docs.arc.io/arc/references/rpc-endpoints.
const RPC_SEED = {
  arc: [
    "https://rpc.mainnet.arc.io",
    "https://rpc.blockdaemon.mainnet.arc.io",
    "https://rpc.drpc.mainnet.arc.io",
    "https://rpc.quicknode.mainnet.arc.io",
  ],
};

const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

/**
 * Per-chain RPC override: `ZERION_RPC_URL_<CHAIN>`, where <CHAIN> is the Zerion
 * chain id upper-cased with `-` replaced by `_` (binance-smart-chain →
 * ZERION_RPC_URL_BINANCE_SMART_CHAIN). Mirrors the existing SOLANA_RPC_URL
 * escape hatch. Tried first; the catalog's own URLs stay on as fallbacks.
 */
function rpcOverrideFor(chainId) {
  const url = process.env[`ZERION_RPC_URL_${chainId.toUpperCase().replace(/-/g, "_")}`]?.trim();
  return isHttpUrl(url) ? url : null;
}

function toConfig(item) {
  const id = item.id;
  if (!id) return null;
  const attrs = item.attributes || {};
  const flags = attrs.flags || {};
  const externalIdHex = attrs.external_id || "";
  const chainIdNum = externalIdHex ? Number.parseInt(externalIdHex, 16) : null;
  const rpcHttpUrls = [
    ...new Set([
      rpcOverrideFor(id),
      ...(attrs.rpc?.public_servers_url || []),
      ...(RPC_SEED[id] || []),
    ].filter(isHttpUrl)),
  ];

  return {
    id,
    name: attrs.name || id,
    externalIdHex,
    chainIdNum: Number.isSafeInteger(chainIdNum) ? chainIdNum : null,
    rpcHttpUrls,
    nativeFungibleId: item.relationships?.native_fungible?.data?.id || null,
    flags: {
      supportsTrading: flags.supports_trading ?? false,
      supportsBridge: flags.supports_bridge ?? false,
      supportsSending: flags.supports_sending ?? false,
    },
    caip2: chainIdNum ? `eip155:${chainIdNum}` : null,
    viemChain: chainIdNum
      ? {
          id: chainIdNum,
          name: attrs.name || id,
          nativeCurrency: { name: attrs.name || id, symbol: "ETH", decimals: 18 },
          rpcUrls: {
            default: { http: rpcHttpUrls },
            public: { http: rpcHttpUrls },
          },
        }
      : null,
  };
}

export async function resolveChain(zerionId) {
  if (!zerionId) return null;
  const catalog = await loadCatalog();
  return catalog.get(zerionId) || null;
}

export async function listTradingChainIds() {
  const catalog = await loadCatalog();
  return [...catalog.values()].filter((c) => c.flags.supportsTrading).map((c) => c.id).sort();
}

export async function listBridgeChainIds() {
  const catalog = await loadCatalog();
  return [...catalog.values()].filter((c) => c.flags.supportsBridge).map((c) => c.id).sort();
}

export async function listSendingChainIds() {
  const catalog = await loadCatalog();
  return [...catalog.values()].filter((c) => c.flags.supportsSending).map((c) => c.id).sort();
}

// Lazy-fetch and cache a chain's native fungible (e.g. MON on monad, ETH on
// ethereum). The native fungible carries the real symbol and decimals, which
// the chains endpoint omits — needed to resolve queries like
// `swap MON USDC --chain monad` to the native asset rather than wrapped MON.
const nativeFungibleCache = new Map();

export async function getNativeFungible(chainId) {
  if (!chainId) return null;
  if (nativeFungibleCache.has(chainId)) return nativeFungibleCache.get(chainId);

  const config = await resolveChain(chainId);
  if (!config?.nativeFungibleId) {
    nativeFungibleCache.set(chainId, null);
    return null;
  }

  const promise = api.getFungible(config.nativeFungibleId).then((res) => {
    const data = res?.data;
    if (!data) return null;
    const attrs = data.attributes || {};
    const impl =
      (attrs.implementations || []).find((i) => i.chain_id === chainId) ||
      attrs.implementations?.[0] ||
      {};
    return {
      fungibleId: data.id,
      symbol: attrs.symbol || "",
      name: attrs.name || "",
      decimals: impl.decimals ?? 18,
    };
  }).catch((err) => {
    nativeFungibleCache.delete(chainId);
    throw err;
  });

  nativeFungibleCache.set(chainId, promise);
  return promise;
}

// Test seam — build a catalog straight from a `/chains/` payload, so tests can
// cover URL resolution (overrides, seeds, de-duplication) rather than stubbing
// the shape it produces.
export function __buildCatalogForTests(response) {
  return buildCatalog(response);
}

// Test seam — let unit tests inject a fixture catalog without hitting the network.
export function __setCatalogForTests(map) {
  catalogPromise = map ? Promise.resolve(map) : null;
  nativeFungibleCache.clear();
}
