/**
 * wallet analyze — full wallet analysis with parallel data fetching.
 * Returns a concise summary (portfolio, top positions, recent txs, PnL).
 */

import { fetchAPI, getPortfolio } from "../../utils/api/client.js";
import { summarizeAnalyze } from "../../utils/common/analyze.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAuth } from "../../utils/api/auth.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import {
  resolveReadChainAsync,
  resolvePositionFilterForAddress,
  resolvePositionsFlag,
} from "../../utils/common/validate.js";

export default async function walletAnalyze(args, flags) {
  // Validate against the live catalog (not the static 14-chain registry) so any
  // chain Zerion indexes can be filtered on.
  const chainCheck = await resolveReadChainAsync(flags.chain);
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      suggestion: chainCheck.error.suggestion,
    });
    process.exit(1);
  }
  const chainId = chainCheck.chainId;

  // `--defi` is a synonym for `--positions defi` here too. `analyze` used to
  // read only `flags.positions`, so `--defi` was silently ignored — including
  // on Solana, where it must refuse rather than return token holdings.
  const positionsFlag = resolvePositionsFlag(flags);
  if (positionsFlag.error) {
    const { code, message, ...details } = positionsFlag.error;
    printError(code, message, details);
    process.exit(1);
  }

  const { walletName, address: resolved } = await resolveAddressOrWallet(args, flags);
  const addr = encodeURIComponent(resolved);
  const txLimit = flags.limit ? parseInt(flags.limit, 10) : 10;

  // Same Solana rule as `positions`: `only_simple` is the only filter that
  // endpoint accepts for base58 addresses. Without this the positions leg 400s
  // and `analyze` reports `count: 0` with a `failures` entry — which reads like
  // an empty wallet rather than a filter the API refused.
  const filterCheck = resolvePositionFilterForAddress(resolved, positionsFlag.value);
  if (filterCheck.error) {
    printError(filterCheck.error.code, filterCheck.error.message, {
      suggestion: filterCheck.error.suggestion,
    });
    process.exit(1);
  }

  const posParams = { "filter[positions]": filterCheck.filter };
  const txParams = { "page[size]": txLimit };
  if (chainId) {
    posParams["filter[chain_ids]"] = chainId;
    txParams["filter[chain_ids]"] = chainId;
  }

  try {
    const auth = resolveAuth(flags);
    const results = await Promise.allSettled([
      // Go through getPortfolio so the total carries the same
      // `filter[positions]` default as everything else — fetching this endpoint
      // raw is what let the summary pair an only_simple total with a
      // no_filter position list.
      getPortfolio(resolved, { auth }),
      fetchAPI(`/wallets/${addr}/positions/`, posParams, auth),
      fetchAPI(`/wallets/${addr}/transactions/`, txParams, auth),
      fetchAPI(`/wallets/${addr}/pnl`, {}, auth),
    ]);

    const labels = ["portfolio", "positions", "transactions", "pnl"];
    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const failures = results
      .map((r, i) => (r.status === "rejected" ? labels[i] : null))
      .filter(Boolean);

    // Pass --chain through: the positions and transactions legs are filtered by
    // it, so the total has to be that chain's slice or the summary reports a
    // wallet-wide number over a one-chain list (same fix as `portfolio`).
    const summary = summarizeAnalyze(resolved, ...values, { chainId });
    if (walletName !== resolved) summary.label = walletName;
    if (failures.length) summary.failures = failures;
    if (filterCheck.note) summary.notes = [filterCheck.note];
    if (auth.kind !== "apiKey") summary.auth = auth.kind;

    print(summary);
  } catch (err) {
    printError(err.code || "analyze_error", err.message);
    process.exit(1);
  }
}
