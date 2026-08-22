/**
 * Portfolio totals — reading the `/portfolio` attributes coherently.
 *
 * The endpoint takes no chain filter, so a `--chain` narrows the *position
 * list* but not the total. Reporting the wallet-wide number above a one-chain
 * list is the bug this helper exists to prevent: take that chain's slice of
 * `positions_distribution_by_chain` instead, and drop the 24h change, which the
 * API only publishes wallet-wide (WLT-2076).
 *
 * The distribution's keys are the same chain ids the catalog resolves `--chain`
 * to, so a chain the wallet holds nothing on is simply absent.
 *
 * A missing total stays `null` — "the API didn't tell us" is not the same claim
 * as "$0", so callers that need a number to render apply their own default.
 */
export function portfolioTotals(attributes, chainId) {
  const attrs = attributes ?? {};
  if (!chainId) {
    return {
      total: attrs.total?.positions ?? null,
      change24h: attrs.changes?.absolute_1d ?? null,
    };
  }
  return {
    total: attrs.positions_distribution_by_chain?.[chainId] ?? null,
    change24h: null,
  };
}
