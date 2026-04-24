/**
 * wallet analyze — full wallet analysis with parallel data fetching.
 * Returns a concise summary (portfolio, top positions, recent txs, PnL).
 */

import { fetchAPI } from "../../lib/api/client.js";
import { summarizeAnalyze } from "../../lib/util/analyze.js";
import { print, printError } from "../../lib/util/output.js";
import { resolveX402 } from "../../lib/api/x402.js";
import { resolveAddressOrWallet } from "../../lib/wallet/resolve.js";
import { validateChain } from "../../lib/util/validate.js";

export default async function walletAnalyze(args, flags) {
  const chainErr = validateChain(flags.chain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  const { walletName, address: resolved } = await resolveAddressOrWallet(args, flags);
  const useX402 = resolveX402(flags);
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
    const results = await Promise.allSettled([
      fetchAPI(`/wallets/${addr}/portfolio`, {}, useX402),
      fetchAPI(`/wallets/${addr}/positions/`, posParams, useX402),
      fetchAPI(`/wallets/${addr}/transactions/`, txParams, useX402),
      fetchAPI(`/wallets/${addr}/pnl`, {}, useX402),
    ]);

    const labels = ["portfolio", "positions", "transactions", "pnl"];
    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const failures = results
      .map((r, i) => (r.status === "rejected" ? labels[i] : null))
      .filter(Boolean);

    const summary = summarizeAnalyze(resolved, ...values);
    if (walletName !== resolved) summary.label = walletName;
    if (failures.length) summary.failures = failures;
    if (useX402) summary.auth = "x402";

    print(summary);
  } catch (err) {
    printError(err.code || "analyze_error", err.message);
    process.exit(1);
  }
}
