/**
 * Pure logic for `zerion bundle` — normalising the repeatable `--group` input,
 * the same-signer invariant, strictest-wins routing, aggregate-outflow math,
 * quote-freshness heuristics, and the top-level status roll-up. The CLI shell
 * in `cli/commands/trading/bundle.js` owns the network (policies, balances,
 * handoff, local signing); everything testable without mocks lives here.
 *
 * See docs/prd/cli-bundle.md and ADRs 0003–0005.
 */

/**
 * Normalise the `--group` flag value into an array of raw strings. `parseFlags`
 * collects a repeated flag into an array and a single one into a scalar; a bare
 * `--group` (no value) parses as `true`. Throws `{ code: "missing_groups" }`
 * when nothing usable was passed.
 */
export function normalizeGroupInputs(raw) {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && v.length > 0);
  if (list.length === 0) {
    const err = new Error(
      "bundle requires at least one --group. Pass the output of `--prepare` commands, " +
      'e.g. --group "$(zerion swap base 100 USDC ETH --prepare)".'
    );
    err.code = "missing_groups";
    throw err;
  }
  return list;
}

// EVM addresses compare case-insensitively; Solana base58 is case-sensitive.
function normAddress(address, ecosystem) {
  return ecosystem === "evm" ? String(address).toLowerCase() : String(address);
}

/**
 * Enforce the cross-group invariant: every prepared group must name the **same
 * signer address** (⇒ the same ecosystem). Chains may differ (a bundle may span
 * chains for one signer). Throws `{ code: "mixed_address" }` on any mismatch.
 * Returns `{ address, ecosystem }` on success.
 */
export function assertSameSigner(groups) {
  const first = groups[0];
  const key = normAddress(first.address, first.ecosystem);
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    if (g.ecosystem !== first.ecosystem || normAddress(g.address, g.ecosystem) !== key) {
      const err = new Error(
        `All --group envelopes must share one signer address. ` +
        `Group #1 is ${first.address} (${first.ecosystem}); group #${i + 1} is ${g.address} (${g.ecosystem}).`
      );
      err.code = "mixed_address";
      throw err;
    }
  }
  return { address: first.address, ecosystem: first.ecosystem };
}

/**
 * Strictest-wins routing: if **any** group routed to the web app, the whole
 * queue delegates to the web app (one link). Only when **all** groups are
 * local does the bundle sign locally.
 */
export function decideBundleRoute(groups) {
  return groups.some((g) => g.route === "web-app") ? "web-app" : "local";
}

/**
 * Aggregate sell-side outflows across all groups, keyed by (chain, token). The
 * three-10-USDC-sends case (each fine alone, 30 > balance together) is caught
 * by comparing these sums to live balances in the CLI shell.
 *
 * @returns {Array<{ chain, symbol, tokenAddress, fungibleId, native, amount }>}
 */
export function aggregateOutflows(groups) {
  const agg = new Map();
  for (const g of groups) {
    for (const o of g.outflows || []) {
      const amt = Number(o.amount);
      if (!Number.isFinite(amt)) continue;
      const token = (o.tokenAddress || o.fungibleId || o.symbol || "").toLowerCase();
      const key = `${o.chain}:${token}:${o.native ? "native" : "token"}`;
      const existing = agg.get(key);
      if (existing) {
        existing.amount += amt;
      } else {
        agg.set(key, {
          chain: o.chain,
          symbol: o.symbol,
          tokenAddress: o.tokenAddress || null,
          fungibleId: o.fungibleId || null,
          native: Boolean(o.native),
          amount: amt,
        });
      }
    }
  }
  return [...agg.values()];
}

/**
 * Find the wallet balance (float) for an aggregated outflow within a positions
 * response (`api.getPositions(...).data`). Matches by on-chain implementation
 * address when the outflow carries one, else by symbol. Returns `null` when no
 * matching wallet position is found (caller warns rather than false-refusing).
 */
export function matchPositionBalance(positions, outflow) {
  const wantAddr = outflow.tokenAddress ? String(outflow.tokenAddress).toLowerCase() : null;
  const wantSym = outflow.symbol ? String(outflow.symbol).toUpperCase() : null;
  for (const row of positions || []) {
    const attrs = row?.attributes || {};
    if (attrs.position_type && attrs.position_type !== "wallet") continue;
    const fi = attrs.fungible_info || {};
    const impls = fi.implementations || [];
    const addrMatch =
      wantAddr && impls.some((i) => i?.address && String(i.address).toLowerCase() === wantAddr);
    const symMatch = wantSym && fi.symbol && String(fi.symbol).toUpperCase() === wantSym;
    if (addrMatch || (!wantAddr && symMatch)) {
      const bal = attrs.quantity?.float;
      if (typeof bal === "number") return bal;
    }
  }
  return null;
}

/**
 * Best-effort quote-freshness heuristic: a prepared group carries `preparedAt`,
 * and `bundle` cannot silently re-quote, so warn when a group is older than
 * `maxAgeSeconds` (a stale swap quote may no longer be executable). Returns a
 * list of human warning strings (empty when all fresh).
 */
export function quoteFreshnessWarnings(groups, { nowMs, maxAgeSeconds = 120 } = {}) {
  const warnings = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g.preparedAt) continue;
    const ts = Date.parse(g.preparedAt);
    if (!Number.isFinite(ts)) continue;
    const ageSec = (nowMs - ts) / 1000;
    if (ageSec > maxAgeSeconds) {
      warnings.push(
        `group #${i + 1} was prepared ${Math.round(ageSec)}s ago (> ${maxAgeSeconds}s) — ` +
        `a swap quote may be stale; bundle cannot re-quote.`
      );
    }
  }
  return warnings;
}

/**
 * Roll per-group statuses up to the bundle's top-level status (§4.1): every
 * group completed → "completed"; every group rejected → "rejected"; no group
 * completed → "failed"; otherwise "partial".
 */
export function computeBundleStatus(statuses) {
  if (statuses.length === 0) return "failed";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.every((s) => s === "rejected")) return "rejected";
  if (statuses.some((s) => s === "completed")) return "partial";
  return "failed";
}
