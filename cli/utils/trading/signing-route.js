/**
 * Signing router — decides, per transaction bundle, between signing locally
 * (OWS keystore, unattended) and handing off to the web app for human review.
 *
 * Production model (ADR-0001): local signing is the default; the handoff fires
 * when any trigger hits:
 *   1. read-only wallet   — no key material, can only sign via the browser
 *   2. force flag         — the caller explicitly asked for review (--review)
 *   3. value over threshold — sell-side USD exceeds the wallet's review threshold
 *
 * Fail-closed: if a review threshold is set but the bundle's USD value could not
 * be determined, route to review rather than auto-sign an unpriced transaction.
 */

import { getReviewThreshold } from "../config.js";
import { isReadonlyWallet } from "../wallet/readonly.js";

/**
 * @param {object} args
 * @param {string} args.walletName - resolved wallet name (for threshold/read-only lookup)
 * @param {boolean} [args.force] - caller forced review (--review)
 * @param {number|null} [args.usdValue] - sell-side USD value of the bundle, or null if unknown
 * @returns {{ route: 'local'|'web-app', reason: string }}
 */
export function decideSigningRoute({ walletName, force = false, usdValue = null }) {
  if (isReadonlyWallet(walletName)) {
    return { route: "web-app", reason: "read-only wallet" };
  }
  if (force) {
    return { route: "web-app", reason: "review forced (--review)" };
  }

  const threshold = getReviewThreshold(walletName);
  if (threshold != null) {
    if (usdValue == null) {
      return {
        route: "web-app",
        reason: `value unknown with a $${threshold} review threshold set (fail-closed)`,
      };
    }
    if (usdValue > threshold) {
      return {
        route: "web-app",
        reason: `value $${usdValue.toFixed(2)} exceeds $${threshold} review threshold`,
      };
    }
  }

  return { route: "local", reason: "auto-sign" };
}

/**
 * Message-signing router (EIP-191 / EIP-712) — same model as transactions but
 * without the value trigger: review thresholds are USD amounts and messages
 * have no sell-side value, so only the read-only and force triggers apply.
 *
 * @param {object} args
 * @param {string} args.walletName - resolved wallet name (for read-only lookup)
 * @param {boolean} [args.force] - caller forced review (--review)
 * @returns {{ route: 'local'|'web-app', reason: string }}
 */
export function decideMessageSigningRoute({ walletName, force = false }) {
  if (isReadonlyWallet(walletName)) {
    return { route: "web-app", reason: "read-only wallet" };
  }
  if (force) {
    return { route: "web-app", reason: "review forced (--review)" };
  }
  return { route: "local", reason: "auto-sign" };
}
