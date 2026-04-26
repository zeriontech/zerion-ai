/**
 * Wallet analysis summarizer — transforms raw Zerion API responses
 * into a concise summary (portfolio, top positions, recent txs, PnL).
 */

export function summarizeAnalyze(address, portfolio, positions, transactions, pnl) {
  const topPositions = Array.isArray(positions?.data)
    ? positions.data
        .sort((a, b) => (b.attributes?.value ?? 0) - (a.attributes?.value ?? 0))
        .slice(0, 10)
        .map((p) => ({
          name: p.attributes?.fungible_info?.name ?? p.attributes?.name ?? "Unknown",
          symbol: p.attributes?.fungible_info?.symbol ?? null,
          value: p.attributes?.value ?? 0,
          quantity: p.attributes?.quantity?.float ?? null,
          chain: p.relationships?.chain?.data?.id ?? null,
        }))
    : [];

  const recentTxs = Array.isArray(transactions?.data)
    ? transactions.data.slice(0, 5).map((tx) => ({
        hash: tx.attributes?.hash ?? null,
        status: tx.attributes?.status ?? null,
        mined_at: tx.attributes?.mined_at ?? null,
        operation_type: tx.attributes?.operation_type ?? null,
        fee: tx.attributes?.fee?.value ?? null,
        transfers: Array.isArray(tx.attributes?.transfers)
          ? tx.attributes.transfers.map((t) => ({
              direction: t.direction,
              fungible_info: t.fungible_info
                ? { name: t.fungible_info.name, symbol: t.fungible_info.symbol }
                : null,
              quantity: t.quantity?.float ?? null,
              value: t.value ?? null,
            }))
          : [],
      }))
    : [];

  return {
    wallet: { query: address },
    portfolio: {
      total: portfolio?.data?.attributes?.total?.positions ?? null,
      currency: "usd",
      change_1d: portfolio?.data?.attributes?.changes ?? null,
      chains: portfolio?.data?.attributes?.positions_distribution_by_chain ?? null,
    },
    positions: {
      count: Array.isArray(positions?.data) ? positions.data.length : 0,
      top: topPositions,
    },
    transactions: {
      sampled: Array.isArray(transactions?.data) ? transactions.data.length : 0,
      recent: recentTxs,
    },
    pnl: {
      available: Boolean(pnl?.data),
      summary: pnl?.data?.attributes ?? null,
    },
  };
}
