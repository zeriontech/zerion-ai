// Zerion API HTTP client — native fetch + Basic Auth + x402/MPP pay-per-call.
// Auth resolution lives in ./auth.js. Callers pass the resolved { kind, ... }
// object through `auth` / `options.auth`. When omitted, fetchAPI falls back
// to apiKey — pay-per-call is opt-in only through resolveAuth(flags), which
// only analytics commands call. Trading commands hit this fallback and
// always use the API key regardless of ZERION_X402 / ZERION_MPP env vars.

import { API_BASE } from "../common/constants.js";
import { basicAuthHeader, resolveApiKeyAuth } from "./auth.js";
import { getX402Fetch } from "./x402.js";
import { getMppFetch } from "./mpp.js";

export async function fetchAPI(pathname, params = {}, auth) {
  const resolved = auth || resolveApiKeyAuth();

  const url = new URL(`${API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const headers = { Accept: "application/json" };
  let fetchFn;
  switch (resolved.kind) {
    case "apiKey":
      headers.Authorization = basicAuthHeader(resolved.key);
      fetchFn = fetch;
      break;
    case "x402":
      fetchFn = await getX402Fetch(resolved);
      break;
    case "mpp":
      fetchFn = await getMppFetch(resolved);
      break;
    default:
      throw new Error(`fetchAPI: unknown auth kind: ${resolved.kind}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetchFn(url, { headers, signal: controller.signal });
  clearTimeout(timer);

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { _rawText: text.slice(0, 500) };
  }

  if (!response.ok) {
    const err = new Error(
      `Zerion API error: ${response.status} ${response.statusText}`
    );
    err.code = "api_error";
    err.status = response.status;
    err.response = payload;
    throw err;
  }

  return payload;
}

// --- Wallet endpoints ---

export async function getPortfolio(address, options = {}) {
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/portfolio`, {
    currency: options.currency || "usd",
  }, options.auth);
}

export async function getPositions(address, options = {}) {
  const params = {
    "filter[positions]": options.positionFilter || "no_filter",
    currency: "usd",
    sort: "value",
  };
  if (options.chainId) params["filter[chain_ids]"] = options.chainId;
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/positions/`, params, options.auth);
}

export async function getPnl(address, options = {}) {
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/pnl`, {}, options.auth);
}

export async function getTransactions(address, options = {}) {
  const params = {
    "page[size]": options.limit || 10,
    currency: "usd",
  };
  if (options.chainId) params["filter[chain_ids]"] = options.chainId;
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/transactions/`, params, options.auth);
}

// --- Fungibles endpoints ---

export async function searchFungibles(query, options = {}) {
  const params = {
    "filter[search_query]": query,
    currency: "usd",
    sort: "-market_data.market_cap",
    "page[size]": options.limit || 10,
  };
  if (options.chainId) params["filter[chain_ids]"] = options.chainId;
  return fetchAPI("/fungibles/", params, options.auth);
}

export async function getFungible(fungibleId, options = {}) {
  return fetchAPI(`/fungibles/${fungibleId}`, {}, options.auth);
}

// --- Chain endpoints ---

export async function getChains(options = {}) {
  return fetchAPI("/chains/", {}, options.auth);
}

export async function getGasPrices(chainId, options = {}) {
  return fetchAPI("/gas/", {
    "filter[chain_id]": chainId || "ethereum",
  }, options.auth);
}

// --- Swap endpoints ---

export async function getSwapOffers(params, options = {}) {
  return fetchAPI("/swap/offers/", params, options.auth);
}

export async function getSwapFungibles(inputChainId, outputChainId, options = {}) {
  return fetchAPI("/swap/fungibles/", {
    "input[chain_id]": inputChainId || "ethereum",
    "output[chain_id]": outputChainId || "ethereum",
    direction: "both",
  }, options.auth);
}
