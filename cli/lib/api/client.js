// Zerion API HTTP client — native fetch + Basic Auth + x402/MPP pay-per-call.

import { API_BASE } from "../util/constants.js";
import { getApiKey } from "../config.js";
import { getX402Fetch } from "./x402.js";
import { getMppFetch } from "./mpp.js";

export function basicAuthHeader(key) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export async function fetchAPI(pathname, params = {}, { useX402 = false, useMpp = false } = {}) {
  if (useX402 && useMpp) {
    throw new Error("--x402 and --mpp are mutually exclusive");
  }

  const payPerCall = useX402 || useMpp;
  const apiKey = payPerCall ? null : getApiKey();
  if (!payPerCall && !apiKey) {
    const err = new Error(
      "ZERION_API_KEY is required. Get one at https://developers.zerion.io\n" +
      "Alternatively, use --x402 or --mpp for pay-per-call (no API key needed)."
    );
    err.code = "missing_api_key";
    throw err;
  }

  const url = new URL(`${API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const headers = { Accept: "application/json" };

  if (!payPerCall) {
    headers.Authorization = basicAuthHeader(apiKey);
  }

  const fetchFn = useMpp  ? await getMppFetch()
                : useX402 ? await getX402Fetch()
                : fetch;
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
  }, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getPositions(address, options = {}) {
  const params = {
    "filter[positions]": options.positionFilter || "no_filter",
    currency: "usd",
    sort: "value",
  };
  if (options.chainId) params["filter[chain_ids]"] = options.chainId;
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/positions/`, params, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getPnl(address, options = {}) {
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/pnl`, {}, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getTransactions(address, options = {}) {
  const params = {
    "page[size]": options.limit || 10,
    currency: "usd",
  };
  if (options.chainId) params["filter[chain_ids]"] = options.chainId;
  return fetchAPI(`/wallets/${encodeURIComponent(address)}/transactions/`, params, { useX402: options.useX402, useMpp: options.useMpp });
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
  return fetchAPI("/fungibles/", params, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getFungible(fungibleId, options = {}) {
  return fetchAPI(`/fungibles/${fungibleId}`, {}, { useX402: options.useX402, useMpp: options.useMpp });
}

// --- Chain endpoints ---

export async function getChains(options = {}) {
  return fetchAPI("/chains/", {}, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getGasPrices(chainId, options = {}) {
  return fetchAPI("/gas/", {
    "filter[chain_id]": chainId || "ethereum",
  }, { useX402: options.useX402, useMpp: options.useMpp });
}

// --- Swap endpoints ---

export async function getSwapOffers(params, options = {}) {
  return fetchAPI("/swap/offers/", params, { useX402: options.useX402, useMpp: options.useMpp });
}

export async function getSwapFungibles(inputChainId, outputChainId, options = {}) {
  return fetchAPI("/swap/fungibles/", {
    "input[chain_id]": inputChainId || "ethereum",
    "output[chain_id]": outputChainId || "ethereum",
    direction: "both",
  }, { useX402: options.useX402, useMpp: options.useMpp });
}
