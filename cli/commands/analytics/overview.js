/**
 * wallet analyze — full wallet analysis with parallel data fetching.
 * Returns a concise summary (portfolio, top positions, recent txs, PnL).
 */

import { fetchAPI } from "../../lib/api/client.js";
import { summarizeAnalyze } from "../../lib/analyze.js";
import { print, printError } from "../../lib/util/output.js";
import { isX402Enabled } from "../../lib/api/x402.js";

export default async function walletAnalyze(args, flags) {
  const address = args[0] || flags.address;
  if (!address) {
    printError("missing_wallet", "A wallet address or ENS name is required.");
    process.exit(1);
  }

  const useX402 = flags.x402 === true || isX402Enabled();
  const addr = encodeURIComponent(address);
  const txLimit = flags.limit ? parseInt(flags.limit) : 10;

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

    const summary = summarizeAnalyze(address, ...values);
    if (failures.length) summary.failures = failures;
    if (useX402) summary.auth = "x402";

    print(summary);
  } catch (err) {
    printError(err.code || "analyze_error", err.message);
    process.exit(1);
  }
}
