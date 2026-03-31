#!/usr/bin/env node

/**
 * Zerion CLI — unified entry point for wallet analysis and trading.
 * Routes argv to command handlers via the router.
 */

import { register, registerSingle, dispatch } from "./router.js";
import { printError, setPrettyMode } from "./lib/output.js";

// Enable --pretty if flag present or auto-detect TTY
if (process.argv.includes("--pretty") || (process.stdout.isTTY && !process.argv.includes("--json"))) {
  setPrettyMode(true);
}

// --- Wallet management (lazy-loaded: OWS, Solana, qrcode) ---

import walletCreate from "./commands/wallet-create.js";
import walletImport from "./commands/wallet-import.js";
import walletList from "./commands/wallet-list.js";
import walletFund from "./commands/wallet-fund.js";
import walletExport from "./commands/wallet-export.js";
register("wallet", "create", walletCreate);
register("wallet", "import", walletImport);
register("wallet", "list", walletList);
register("wallet", "fund", walletFund);
register("wallet", "export", walletExport);

// --- Wallet read features (portfolio, positions, PnL, history, analyze) ---

import walletAnalyze from "./commands/wallet-analyze.js";
import walletPositions from "./commands/wallet-positions.js";
import portfolio from "./commands/portfolio.js";
import pnl from "./commands/pnl.js";
import history from "./commands/history.js";
register("wallet", "analyze", walletAnalyze);
register("wallet", "portfolio", portfolio);
register("wallet", "positions", walletPositions);
register("wallet", "transactions", history);
register("wallet", "pnl", pnl);
registerSingle("portfolio", portfolio);
registerSingle("pnl", pnl);
registerSingle("history", history);

// --- Token search ---

import search from "./commands/search.js";
registerSingle("search", search);

// --- Chains ---

import chainsCmd from "./commands/chains.js";
registerSingle("chains", chainsCmd);
register("chains", "list", chainsCmd);

// --- Trading (swap/bridge/buy/sell) ---

import swap from "./commands/swap.js";
import bridge from "./commands/bridge.js";
import buy from "./commands/buy.js";
import sell from "./commands/sell.js";
import swapTokens from "./commands/swap-tokens.js";
registerSingle("swap", swap);
register("swap", "tokens", swapTokens);
registerSingle("bridge", bridge);
registerSingle("buy", buy);
registerSingle("sell", sell);

// --- Export to Zerion app ---

import exportCmd from "./commands/export.js";
registerSingle("export", exportCmd);

// --- Watchlist + analysis ---

import watch from "./commands/watch.js";
import analyze from "./commands/analyze.js";
registerSingle("watch", watch);
registerSingle("analyze", analyze);

// --- Agent tokens ---

import agentCreateToken from "./commands/agent-create-token.js";
import agentListTokens from "./commands/agent-list-tokens.js";
import agentRevokeToken from "./commands/agent-revoke-token.js";
register("agent", "create-token", agentCreateToken);
register("agent", "list-tokens", agentListTokens);
register("agent", "revoke-token", agentRevokeToken);

// --- Agent policies ---

import agentCreatePolicy from "./commands/agent-create-policy.js";
import agentListPolicies from "./commands/agent-list-policies.js";
import agentShowPolicy from "./commands/agent-show-policy.js";
import agentDeletePolicy from "./commands/agent-delete-policy.js";
register("agent", "create-policy", agentCreatePolicy);
register("agent", "list-policies", agentListPolicies);
register("agent", "show-policy", agentShowPolicy);
register("agent", "delete-policy", agentDeletePolicy);

// --- Config ---

import configCmd from "./commands/config-cmd.js";
registerSingle("config", configCmd);

// --- Dispatch ---

try {
  await dispatch(process.argv.slice(2));
} catch (err) {
  printError(err.code || "unexpected_error", err.message);
  process.exit(1);
}
