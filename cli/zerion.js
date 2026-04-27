#!/usr/bin/env node

/**
 * Zerion CLI — unified entry point for wallet analysis and trading.
 * Routes argv to command handlers via the router.
 */

import { register, registerSingle, dispatch } from "./router.js";
import { printError, setPrettyMode } from "./utils/common/output.js";
import { migrateFromZerionCli } from "./utils/common/migrate.js";

// Migrate config from ~/.zerion-cli → ~/.zerion on first run after upgrade
migrateFromZerionCli();

// Enable --pretty if flag present or auto-detect TTY
if (process.argv.includes("--pretty") || (process.stdout.isTTY && !process.argv.includes("--json"))) {
  setPrettyMode(true);
}

// --- Wallet management ---

import walletCreate from "./commands/wallet/create.js";
import walletImport from "./commands/wallet/import.js";
import walletList from "./commands/wallet/list.js";
import walletFund from "./commands/wallet/fund.js";
import walletBackup from "./commands/wallet/backup.js";
import walletDelete from "./commands/wallet/delete.js";
import walletSync from "./commands/wallet/sync.js";
import walletSignMessage from "./commands/wallet/sign-message.js";
import walletSignTypedData from "./commands/wallet/sign-typed-data.js";
import watch from "./commands/wallet/watch.js";
register("wallet", "create", walletCreate);
register("wallet", "import", walletImport);
register("wallet", "list", walletList);
register("wallet", "fund", walletFund);
register("wallet", "backup", walletBackup);
register("wallet", "delete", walletDelete);
register("wallet", "sync", walletSync);
registerSingle("sign-message", walletSignMessage);
registerSingle("sign-typed-data", walletSignTypedData);
registerSingle("watch", watch);

// --- Analytics (read-only queries: portfolio, positions, PnL, history, analyze) ---

import positions from "./commands/analytics/positions.js";
import portfolio from "./commands/analytics/portfolio.js";
import pnl from "./commands/analytics/pnl.js";
import history from "./commands/analytics/history.js";
import analyze from "./commands/analytics/overview.js";
registerSingle("portfolio", portfolio);
registerSingle("positions", positions);
registerSingle("pnl", pnl);
registerSingle("history", history);
registerSingle("analyze", analyze);

// --- Trading (swap, bridge, search, chains) ---

import swap from "./commands/trading/swap.js";
import bridge from "./commands/trading/bridge.js";
import send from "./commands/trading/send.js";
import swapTokens from "./commands/trading/list-tokens.js";
import search from "./commands/trading/search.js";
import chainsCmd from "./commands/trading/chains.js";
registerSingle("swap", swap);
register("swap", "tokens", swapTokens);
registerSingle("bridge", bridge);
registerSingle("send", send);
registerSingle("search", search);
registerSingle("chains", chainsCmd);

// --- Agent (tokens and policies) ---

import agentCreateToken from "./commands/agent/create-token.js";
import agentListTokens from "./commands/agent/list-tokens.js";
import agentRevokeToken from "./commands/agent/revoke-token.js";
import agentCreatePolicy from "./commands/agent/create-policy.js";
import agentListPolicies from "./commands/agent/list-policies.js";
import agentShowPolicy from "./commands/agent/show-policy.js";
import agentDeletePolicy from "./commands/agent/delete-policy.js";
import agentUseToken from "./commands/agent/use-token.js";
register("agent", "create-token", agentCreateToken);
register("agent", "list-tokens", agentListTokens);
register("agent", "use-token", agentUseToken);
register("agent", "revoke-token", agentRevokeToken);
register("agent", "create-policy", agentCreatePolicy);
register("agent", "list-policies", agentListPolicies);
register("agent", "show-policy", agentShowPolicy);
register("agent", "delete-policy", agentDeletePolicy);

// --- Config ---

import configCmd from "./commands/config.js";
registerSingle("config", configCmd);

// --- Setup (skills installer wrapper) ---

import setupCmd from "./commands/setup.js";
registerSingle("setup", setupCmd);

// --- Init (one-shot onboarding: install + auth + skills) ---

import initCmd from "./commands/init.js";
registerSingle("init", initCmd);

// --- Dispatch ---

try {
  await dispatch(process.argv.slice(2));
} catch (err) {
  printError(err.code || "unexpected_error", err.message);
  process.exit(1);
}
