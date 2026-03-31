import * as api from "../../lib/api/client.js";
import { resolveAddress } from "../../lib/wallet/resolve.js";
import { resolveWatchAddress } from "../../lib/wallet/watchlist.js";
import { print, printError } from "../../lib/util/output.js";
import { formatAnalysis } from "../../lib/util/format.js";

function parsePeriod(input) {
  if (!input) return 7;
  const match = input.match(/^(\d+)([dw])$/i);
  if (!match) return parseInt(input) || 7;
  const n = parseInt(match[1]);
  return match[2].toLowerCase() === "w" ? n * 7 : n;
}

export default async function analyze(args, flags) {
  const target = args[0] || flags.address || flags.watch;

  if (!target) {
    printError("missing_args", "Address, ENS name, or watchlist name required", {
      example: "zerion analyze vitalik --period 7d",
    });
    process.exit(1);
  }

  const days = parsePeriod(flags.period);

  try {
    // Resolve: watchlist name → address, or ENS → address
    const rawAddress = resolveWatchAddress(target);
    const address = await resolveAddress(rawAddress);

    const [portfolioRes, txRes, pnlRes] = await Promise.all([
      api.getPortfolio(address),
      api.getTransactions(address, { limit: 50, chainId: flags.chain }),
      api.getPnl(address),
    ]);

    // Portfolio summary
    const total = portfolioRes.data?.attributes?.total?.positions ?? 0;

    // Filter transactions within the period
    const cutoff = new Date(Date.now() - days * 86400_000);
    const allTxs = txRes.data || [];
    const txsInPeriod = allTxs.filter((tx) => {
      const ts = tx.attributes?.mined_at;
      return ts && new Date(ts) >= cutoff;
    });

    // Analyze transaction types
    const stats = { swaps: 0, transfers: 0, other: 0, chains: new Set(), totalValue: 0 };
    for (const tx of txsInPeriod) {
      const type = tx.attributes?.operation_type;
      if (type === "trade") stats.swaps++;
      else if (type === "send" || type === "receive") stats.transfers++;
      else stats.other++;

      const chain = tx.relationships?.chain?.data?.id;
      if (chain) stats.chains.add(chain);

      // Sum absolute transfer values
      const transfers = tx.attributes?.transfers || [];
      for (const t of transfers) {
        stats.totalValue += Math.abs(t.value || 0);
      }
    }

    // PnL
    const pnlAttrs = pnlRes.data?.attributes || {};

    const data = {
      address,
      label: target !== address ? target : undefined,
      period: `${days}d`,
      portfolio: { total, currency: "usd" },
      activity: {
        transactions: txsInPeriod.length,
        swaps: stats.swaps,
        transfers: stats.transfers,
        other: stats.other,
        chains: [...stats.chains],
        volumeUsd: stats.totalValue,
      },
      pnl: {
        totalGain: pnlAttrs.total?.gain,
        totalGainPercent: pnlAttrs.total?.gain_percentage,
        realizedGain: pnlAttrs.realized?.gain,
        unrealizedGain: pnlAttrs.unrealized?.gain,
      },
    };

    print(data, formatAnalysis);
  } catch (err) {
    printError(err.code || "analyze_error", err.message);
    process.exit(1);
  }
}
