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

const MAX_429_RETRIES = 5;
const DEFAULT_429_BACKOFF_MS = 1000;

function parseRetryDelayMs(response) {
  // Prefer standard `Retry-After` (seconds or HTTP-date), then fall back to
  // Zerion's `ratelimit-reset` (seconds until window resets). Demo tier is
  // 1 RPS, so the typical reset is 1s — keep that as the floor.
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber)) return Math.max(asNumber * 1000, DEFAULT_429_BACKOFF_MS);
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return Math.max(asDate - Date.now(), DEFAULT_429_BACKOFF_MS);
    }
  }
  const reset = response.headers.get("ratelimit-reset");
  if (reset) {
    const asNumber = Number(reset);
    if (Number.isFinite(asNumber)) return Math.max(asNumber * 1000, DEFAULT_429_BACKOFF_MS);
  }
  return DEFAULT_429_BACKOFF_MS;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetchFn(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      const delay = parseRetryDelayMs(response);
      // Drain the body so the connection can be reused.
      await response.text().catch(() => {});
      attempt += 1;
      await sleep(delay);
      continue;
    }

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
      if (response.status === 429) err.retriesExhausted = attempt;
      throw err;
    }

    return payload;
  }
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
