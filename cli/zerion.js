#!/usr/bin/env node

/**
 * Zerion CLI — unified entry point for wallet analysis and trading.
 * Routes argv to command handlers via the router.
 *
 * Command modules are lazy-loaded so that --help, analytics, and trading
 * commands work on platforms where the wallet/signing native binding
 * (@open-wallet-standard/core) has no prebuilt artifact — currently Windows.
 */

import { register, registerSingle, dispatch } from "./router.js";
import { printError, setPrettyMode } from "./utils/common/output.js";
import { migrateFromZerionCli } from "./utils/common/migrate.js";

migrateFromZerionCli();

if (process.argv.includes("--pretty") || (process.stdout.isTTY && !process.argv.includes("--json"))) {
  setPrettyMode(true);
}

// `@open-wallet-standard/core` ships no Windows binary (no win32 napi triple,
// no `core-win32-*-msvc` optional dep). Its auto-generated index.js still
// tries to require those packages on win32, throwing MODULE_NOT_FOUND.
// We catch that here and convert it to a clear, actionable error instead of
// a raw stack trace from Node's loader.
function isOwsLoadError(err) {
  const msg = (err && (err.message || String(err))) || "";
  return (
    msg.includes("@open-wallet-standard/core") ||
    msg.includes("ows-node") ||
    msg.includes("Failed to load native binding")
  );
}

function lazy(loader) {
  return async (args, flags) => {
    let mod;
    try {
      mod = await loader();
    } catch (err) {
      if (process.platform === "win32" && isOwsLoadError(err)) {
        printError(
          "platform_unsupported",
          "Wallet, signing, agent, and `send` commands are not yet supported on Windows. " +
          "Upstream dependency @open-wallet-standard/core does not publish a Windows binary.",
          {
            supported_on_windows: [
              "portfolio", "positions", "history", "pnl", "analyze",
              "swap", "bridge", "search", "chains",
              "watch", "config", "init", "setup",
            ],
            workarounds: [
              "Use WSL2 (Ubuntu) for full functionality",
              "Use macOS or Linux for wallet/signing commands",
            ],
            tracking_issue: "https://github.com/zeriontech/zerion-ai/issues",
          }
        );
        process.exit(1);
      }
      throw err;
    }
    return mod.default(args, flags);
  };
}

// --- Wallet management ---

register("wallet", "create", lazy(() => import("./commands/wallet/create.js")));
register("wallet", "import", lazy(() => import("./commands/wallet/import.js")));
register("wallet", "list", lazy(() => import("./commands/wallet/list.js")));
register("wallet", "fund", lazy(() => import("./commands/wallet/fund.js")));
register("wallet", "backup", lazy(() => import("./commands/wallet/backup.js")));
register("wallet", "delete", lazy(() => import("./commands/wallet/delete.js")));
register("wallet", "sync", lazy(() => import("./commands/wallet/sync.js")));
registerSingle("sign-message", lazy(() => import("./commands/wallet/sign-message.js")));
registerSingle("sign-typed-data", lazy(() => import("./commands/wallet/sign-typed-data.js")));
registerSingle("watch", lazy(() => import("./commands/wallet/watch.js")));

// --- Analytics (read-only queries: portfolio, positions, PnL, history, analyze) ---

registerSingle("portfolio", lazy(() => import("./commands/analytics/portfolio.js")));
registerSingle("positions", lazy(() => import("./commands/analytics/positions.js")));
registerSingle("pnl", lazy(() => import("./commands/analytics/pnl.js")));
registerSingle("history", lazy(() => import("./commands/analytics/history.js")));
registerSingle("analyze", lazy(() => import("./commands/analytics/overview.js")));

// --- Trading (swap, bridge, search, chains) ---

registerSingle("swap", lazy(() => import("./commands/trading/swap.js")));
register("swap", "tokens", lazy(() => import("./commands/trading/list-tokens.js")));
registerSingle("bridge", lazy(() => import("./commands/trading/bridge.js")));
registerSingle("send", lazy(() => import("./commands/trading/send.js")));
registerSingle("search", lazy(() => import("./commands/trading/search.js")));
registerSingle("chains", lazy(() => import("./commands/trading/chains.js")));

// --- Agent (tokens and policies) ---

register("agent", "create-token", lazy(() => import("./commands/agent/create-token.js")));
register("agent", "list-tokens", lazy(() => import("./commands/agent/list-tokens.js")));
register("agent", "use-token", lazy(() => import("./commands/agent/use-token.js")));
register("agent", "revoke-token", lazy(() => import("./commands/agent/revoke-token.js")));
register("agent", "create-policy", lazy(() => import("./commands/agent/create-policy.js")));
register("agent", "list-policies", lazy(() => import("./commands/agent/list-policies.js")));
register("agent", "show-policy", lazy(() => import("./commands/agent/show-policy.js")));
register("agent", "delete-policy", lazy(() => import("./commands/agent/delete-policy.js")));

// --- Config ---

registerSingle("config", lazy(() => import("./commands/config.js")));

// --- Setup (skills installer wrapper) ---

registerSingle("setup", lazy(() => import("./commands/setup.js")));

// --- Init (one-shot onboarding: install + auth + skills) ---

registerSingle("init", lazy(() => import("./commands/init.js")));

// --- Dispatch ---

try {
  await dispatch(process.argv.slice(2));
} catch (err) {
  printError(err.code || "unexpected_error", err.message);
  process.exit(1);
}
