/**
 * Sell-side USD valuation for a transaction bundle.
 *
 * The signing router uses this to decide whether a transaction exceeds a
 * wallet's review threshold. We value the *sell side* of a bundle — what leaves
 * the wallet — because that's the amount a human reviewer cares about capping:
 *
 *   send        → amount × price(token)
 *   swap/bridge → quote.inputAmount × price(quote.from)
 *   approve     → inherits its bundle's value (never valued on its own)
 *
 * Gas never counts. Prices come from `market_data.price` via the Fungibles API.
 *
 * Returns `null` when no price is available. Callers fail *closed*: an unpriced
 * token with a threshold set routes to review rather than silently auto-signing.
 */

import * as api from "../api/client.js";

/**
 * Fetch the USD price for a fungible id. Returns null on any failure or when the
 * API has no price (never throws — an unpriced token must not crash a trade).
 */
export async function getTokenUsdPrice(fungibleId) {
  if (!fungibleId) return null;
  try {
    const res = await api.getFungible(fungibleId);
    const price = res?.data?.attributes?.market_data?.price;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

/**
 * Sell-side USD value of an amount of a token. `amount` is human-readable
 * (matches the units `send`/`swap` already work in). Returns null if unpriced.
 * @param {object} args
 * @param {string} args.fungibleId
 * @param {string|number} args.amount
 * @returns {Promise<number|null>}
 */
export async function bundleSellUsd({ fungibleId, amount }) {
  const price = await getTokenUsdPrice(fungibleId);
  if (price == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n * price;
}
