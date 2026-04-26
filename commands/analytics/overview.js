/**
 * wallet analyze — full wallet analysis with parallel data fetching.
 * Returns a concise summary (portfolio, top positions, recent txs, PnL).
 */

import { fetchAPI } from "../../utils/api/client.js";
import { summarizeAnalyze } from "../../utils/util/analyze.js";
import { print, printError } from "../../utils/util/output.js";
import { resolveAuth } from "../../utils/api/auth.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import { validateChain } from "../../utils/util/validate.js";

export default async function walletAnalyze(args, flags) {
  const chainErr = validateChain(flags.chain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  const { walletName, address: resolved } = await resolveAddressOrWallet(args, flags);
  const addr = encodeURIComponent(resolved);
  const txLimit = flags.limit ? parseInt(flags.limit, 10) : 10;

  const posParams = { "filter[positions]": "no_filter" };
  const txParams = { "page[size]": txLimit };
  if (flags.chain) {
    posParams["filter[chain_ids]"] = flags.chain;
    txParams["filter[chain_ids]"] = flags.chain;
  }
  if (flags.positions === "simple") posParams["filter[positions]"] = "only_simple";
  else if (flags.positions === "defi") posParams["filter[positions]"] = "only_complex";

  try {
    const auth = resolveAuth(flags);
    const results = await Promise.allSettled([
      fetchAPI(`/wallets/${addr}/portfolio`, {}, auth),
      fetchAPI(`/wallets/${addr}/positions/`, posParams, auth),
      fetchAPI(`/wallets/${addr}/transactions/`, txParams, auth),
      fetchAPI(`/wallets/${addr}/pnl`, {}, auth),
    ]);

    const labels = ["portfolio", "positions", "transactions", "pnl"];
    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const failures = results
      .map((r, i) => (r.status === "rejected" ? labels[i] : null))
      .filter(Boolean);

    const summary = summarizeAnalyze(resolved, ...values);
    if (walletName !== resolved) summary.label = walletName;
    if (failures.length) summary.failures = failures;
    if (auth.kind !== "apiKey") summary.auth = auth.kind;

    print(summary);
  } catch (err) {
    printError(err.code || "analyze_error", err.message);
    process.exit(1);
  }
}
