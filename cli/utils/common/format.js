/**
 * Pretty-print formatters — human-readable output when --pretty is used.
 * No external deps — ANSI escape codes + string padding.
 */

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function pad(str, len) {
  return String(str).padEnd(len);
}

function padStart(str, len) {
  return String(str).padStart(len);
}

// Truncate-then-pad. Use for table cells where overflow would push
// neighboring columns out of alignment (e.g. liquidity-source provider names
// like "stargate-v2-relayer" that exceed the column width).
function padTrunc(str, len) {
  const s = String(str);
  if (s.length <= len) return s.padEnd(len);
  // Reserve one char for the ellipsis so truncation is visible.
  return s.slice(0, len - 1).padEnd(len, "…");
}

function usd(value) {
  if (value == null) return "-";
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value) {
  if (value == null) return "-";
  const n = Number(value);
  const color = n >= 0 ? GREEN : RED;
  return `${color}${n >= 0 ? "+" : ""}${n.toFixed(2)}%${RESET}`;
}

// --- Policy display helpers (shared by list/show/create policy commands) ---

import { fromCaip2 } from "../chain/registry.js";

export function formatPolicyRules(rules) {
  return (rules || []).map((r) => {
    if (r.type === "allowed_chains") {
      return { type: r.type, chains: r.chain_ids.map(fromCaip2) };
    }
    return r;
  });
}

export function shortenScriptPaths(scripts) {
  return (scripts || []).map((s) => s.split("/").pop());
}

// --- Pretty-print formatters ---

export function formatWalletList(data) {
  const showing = data.total !== data.count
    ? `showing ${data.offset + 1}–${data.offset + data.count} of ${data.total}`
    : `${data.total}`;
  const lines = [`${BOLD}Wallets${RESET} (${showing})\n`];
  for (const w of data.wallets) {
    const def = w.isDefault ? ` ${CYAN}(default)${RESET}` : "";
    lines.push(`  ${BOLD}${w.name}${RESET}${def}`);
    if (w.evmAddress) lines.push(`  ${DIM}EVM:${RESET} ${w.evmAddress}`);
    if (w.solAddress) lines.push(`  ${DIM}SOL:${RESET} ${w.solAddress}`);
    if (w.policies?.length) {
      for (const p of w.policies) {
        const detail = p.summary ? ` ${DIM}(${p.summary})${RESET}` : "";
        lines.push(`  ${DIM}Policy:${RESET} ${p.name}${detail}`);
      }
    }
    lines.push("");
  }
  if (data.hasMore) {
    lines.push(`  ${DIM}Use --offset ${data.offset + data.limit} to see more${RESET}\n`);
  }
  return lines.join("\n");
}

export function formatSearch(data) {
  const lines = [`${BOLD}Search: "${data.query}"${RESET} — ${data.count} results\n`];
  lines.push(`  ${DIM}${pad("Token", 20)} ${padStart("Price", 12)} ${padStart("24h", 10)} ${padStart("MCap", 14)}${RESET}`);
  lines.push(`  ${DIM}${"─".repeat(58)}${RESET}`);
  for (const r of data.results) {
    const verified = r.verified ? "✓" : " ";
    lines.push(
      `  ${verified} ${pad(`${r.symbol} (${r.name})`, 18)} ${padStart(usd(r.price), 12)} ${padStart(pct(r.change_24h), 20)} ${padStart(usd(r.market_cap), 14)}`
    );
  }
  return lines.join("\n");
}

export function formatPortfolio(data) {
  const lines = [
    `${BOLD}Portfolio${RESET} — ${data.wallet.name} ${DIM}(${data.wallet.address.slice(0, 8)}...)${RESET}\n`,
    `  Total: ${BOLD}${usd(data.portfolio.total)}${RESET}  24h: ${pct(data.portfolio.change_24h)}\n`,
  ];

  if (data.positions.length > 0) {
    lines.push(`  ${DIM}${pad("Token", 16)} ${pad("Chain", 12)} ${padStart("Value", 12)} ${padStart("Amount", 16)}${RESET}`);
    lines.push(`  ${DIM}${"─".repeat(58)}${RESET}`);
    for (const p of data.positions) {
      lines.push(
        `  ${pad(p.symbol || "?", 16)} ${pad(p.chain || "?", 12)} ${padStart(usd(p.value), 12)} ${padStart(p.quantity?.toFixed(4) || "-", 16)}`
      );
    }
  }
  return lines.join("\n");
}

export function formatPositions(data) {
  const walletLabel = data.wallet.name || data.wallet.address.slice(0, 10) + "...";
  const lines = [
    `${BOLD}Positions${RESET} — ${walletLabel} (${data.count})\n`,
    `  ${DIM}${pad("Token", 16)} ${pad("Chain", 12)} ${padStart("Value", 12)} ${padStart("24h", 18)} ${padStart("Amount", 16)}${RESET}`,
    `  ${DIM}${"─".repeat(76)}${RESET}`,
  ];
  for (const p of data.positions) {
    const change = formatChange(p);
    lines.push(
      `  ${pad(p.symbol || "?", 16)} ${pad(p.chain || "?", 12)} ${padStart(usd(p.value), 12)} ${padStart(change, 28)} ${padStart(p.quantity?.toFixed(4) || "-", 16)}`
    );
  }
  return lines.join("\n");
}

function formatChange(position) {
  if (position.change_percent_1d == null) {
    return `${DIM}-${RESET}`;
  }
  const percent = pct(position.change_percent_1d);
  if (position.change_absolute_1d == null) {
    return percent;
  }
  const sign = position.change_absolute_1d >= 0 ? "+" : "";
  return `${percent} (${sign}${usd(position.change_absolute_1d)})`;
}

function resolveTradeType(data) {
  if (data.swap) return { label: "Swap", detail: data.swap };
  if (data.bridge) return { label: "Bridge", detail: data.bridge };
  if (data.buy) return { label: "Buy", detail: data.buy };
  if (data.send) return { label: "Send", detail: data.send };
  return { label: "Sell", detail: data.sell };
}

export function formatSwapQuote(data) {
  const { label: type, detail: swap } = resolveTradeType(data);
  const lines = [`${BOLD}${type} Quote${RESET}\n`];

  if (swap.input) lines.push(`  ${DIM}Input:${RESET}    ${swap.input}`);
  if (swap.output) lines.push(`  ${DIM}Output:${RESET}   ~${swap.output}`);
  if (swap.spending) lines.push(`  ${DIM}Spending:${RESET} ${swap.spending}`);
  if (swap.receiving) lines.push(`  ${DIM}Receive:${RESET}  ${swap.receiving}`);
  if (swap.selling) lines.push(`  ${DIM}Selling:${RESET}  ${swap.selling}`);
  if (swap.token) lines.push(`  ${DIM}Token:${RESET}    ${swap.amount} ${swap.token}`);
  if (swap.from) lines.push(`  ${DIM}From:${RESET}     ${swap.from}`);
  if (swap.to) lines.push(`  ${DIM}To:${RESET}       ${swap.to}`);
  if (swap.chain) lines.push(`  ${DIM}Chain:${RESET}    ${swap.chain}`);
  if (swap.fee?.protocolPercent != null) {
    lines.push(`  ${DIM}Fee:${RESET}      ${swap.fee.protocolPercent}%`);
  }
  if (swap.source) lines.push(`  ${DIM}Source:${RESET}   ${swap.source}`);
  if (swap.estimatedTime) lines.push(`  ${DIM}Time:${RESET}     ${swap.estimatedTime}`);

  if (data.tx) {
    lines.push("");
    const status = data.tx.status === "success" ? `${GREEN}✓ Success${RESET}` : `${RED}✗ Failed${RESET}`;
    lines.push(`  ${status}`);
    lines.push(`  ${DIM}Hash:${RESET}  ${data.tx.hash}`);
    lines.push(`  ${DIM}Block:${RESET} ${data.tx.blockNumber}`);
    lines.push(`  ${DIM}Gas:${RESET}   ${data.tx.gasUsed}`);
  } else if (data.action) {
    lines.push(`\n  ${YELLOW}${data.action}${RESET}`);
  }

  return lines.join("\n");
}

export function formatBridgeOffers(data) {
  // Column widths chosen to fit comfortably in 80-col terminals. Provider
  // gets truncated (longest known: ~20 chars); numeric columns padStart so
  // alignment holds even when values vary in length.
  const W = { idx: 3, provider: 18, output: 14, time: 8, fee: 8, status: 10 };
  const totalWidth = Object.values(W).reduce((a, b) => a + b, 0) + Object.keys(W).length - 1;

  const lines = [
    `${BOLD}Bridge Quotes${RESET} — ${data.fromChain} → ${data.toChain}  ${DIM}(${data.amount} ${data.fromToken} → ${data.toToken})${RESET}\n`,
  ];
  lines.push(`  ${DIM}${pad("#", W.idx)} ${pad("Provider", W.provider)} ${padStart("Output", W.output)} ${padStart("Time", W.time)} ${padStart("Fee %", W.fee)} ${pad("Status", W.status)}${RESET}`);
  lines.push(`  ${DIM}${"─".repeat(totalWidth)}${RESET}`);
  if (data.offers.length === 0) {
    lines.push(`  ${DIM}(no offers)${RESET}`);
  }
  for (const [i, o] of data.offers.entries()) {
    const time = o.estimatedSeconds != null ? `${o.estimatedSeconds}s` : "-";
    const fee = o.fee?.protocolPercent != null ? `${Number(o.fee.protocolPercent).toFixed(2)}%` : "-";
    const out = o.estimatedOutput ?? "-";
    const provider = o.provider || o.liquiditySource || "(unknown)";
    // Blocked offers stay in the table so users see the full route set, but
    // we mark them clearly — pickOffer will skip these in favor of any
    // executable offer, so the visual ordering ("biggest output wins") would
    // otherwise mislead about what `--cheapest` actually selects.
    const blocked = o.executable === false || o.blocking != null;
    const status = blocked
      ? `${RED}blocked${RESET}`
      : `${GREEN}ready${RESET}`;
    const row = `  ${pad(i + 1, W.idx)} ${padTrunc(provider, W.provider)} ${padStart(out, W.output)} ${padStart(time, W.time)} ${padStart(fee, W.fee)} ${status}`;
    lines.push(blocked ? `${DIM}${row}${RESET}` : row);
  }
  lines.push("");
  lines.push(`  ${YELLOW}Pick one:${RESET} re-run with ${BOLD}--cheapest${RESET} (highest output) or ${BOLD}--fast${RESET} (lowest time). Blocked offers are skipped automatically.`);
  return lines.join("\n");
}

export function formatHistory(data) {
  const lines = [`${BOLD}Transactions${RESET} — ${data.wallet.name} (${data.count})\n`];
  for (const tx of data.transactions) {
    const status = tx.status === "confirmed" ? `${GREEN}✓${RESET}` : `${YELLOW}⏳${RESET}`;
    lines.push(`  ${status} ${DIM}${tx.timestamp || "?"}${RESET}  ${tx.type || "unknown"}  ${DIM}${tx.chain || ""}${RESET}`);
    for (const t of tx.transfers || []) {
      const dir = t.direction === "in" ? `${GREEN}+${RESET}` : `${RED}-${RESET}`;
      lines.push(`    ${dir} ${t.quantity} ${t.fungible || "?"} ${DIM}(${usd(t.value)})${RESET}`);
    }
  }
  return lines.join("\n");
}

export function formatChains(data) {
  const lines = [`${BOLD}Supported Chains${RESET} (${data.count})\n`];
  lines.push(`  ${DIM}${pad("ID", 22)} ${pad("Name", 20)} ${pad("Trade", 6)} ${pad("Bridge", 7)} ${"Send"}${RESET}`);
  lines.push(`  ${DIM}${"─".repeat(64)}${RESET}`);
  for (const c of data.chains) {
    const t = c.supportsTrading ? "✓" : " ";
    const b = c.supportsBridge ? "✓" : " ";
    const s = c.supportsSending ? "✓" : " ";
    lines.push(`  ${pad(c.id, 22)} ${pad(c.name, 20)} ${pad(t, 6)} ${pad(b, 7)} ${s}`);
  }
  return lines.join("\n");
}

export function formatAnalysis(data) {
  const label = data.label ? `${data.label} ` : "";
  const lines = [
    `${BOLD}Analysis${RESET} — ${label}${DIM}(${data.address.slice(0, 8)}...)${RESET}  Period: ${data.period}\n`,
    `  Portfolio: ${BOLD}${usd(data.portfolio.total)}${RESET}`,
    "",
    `  ${BOLD}Activity${RESET}`,
    `  Transactions: ${data.activity.transactions}`,
    `  Swaps:        ${data.activity.swaps}`,
    `  Transfers:    ${data.activity.transfers}`,
    `  Volume:       ${usd(data.activity.volumeUsd)}`,
    `  Chains:       ${data.activity.chains.join(", ") || "none"}`,
  ];

  if (data.pnl.totalGain != null) {
    lines.push("");
    lines.push(`  ${BOLD}PnL${RESET}`);
    lines.push(`  Total Gain:    ${usd(data.pnl.totalGain)} ${pct(data.pnl.totalGainPercent)}`);
    if (data.pnl.realizedGain != null) lines.push(`  Realized:      ${usd(data.pnl.realizedGain)}`);
    if (data.pnl.unrealizedGain != null) lines.push(`  Unrealized:    ${usd(data.pnl.unrealizedGain)}`);
  }

  return lines.join("\n");
}

export function formatPnl(data) {
  const p = data.pnl;
  const lines = [`${BOLD}PnL${RESET} — ${data.wallet.name}\n`];
  if (p.totalGain != null) lines.push(`  Total Gain:     ${usd(p.totalGain)} ${pct(p.totalGainPercent)}`);
  if (p.realizedGain != null) lines.push(`  Realized:       ${usd(p.realizedGain)}`);
  if (p.unrealizedGain != null) lines.push(`  Unrealized:     ${usd(p.unrealizedGain)}`);
  if (p.totalInvested != null) lines.push(`  Total Invested: ${usd(p.totalInvested)}`);
  if (p.netInvested != null) lines.push(`  Net Invested:   ${usd(p.netInvested)}`);
  if (p.totalFees != null) lines.push(`  Fees Paid:      ${usd(p.totalFees)}`);
  return lines.join("\n");
}
