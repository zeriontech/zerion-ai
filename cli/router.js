/**
 * Command router — maps "scope action" to handler functions.
 * Pattern: zerion <scope> <action> [args...] [--flags]
 */

import { parseFlags } from "./lib/flags.js";
import { printError } from "./lib/output.js";

const commands = new Map();

export function register(scope, action, handler) {
  commands.set(`${scope} ${action}`, handler);
}

// Also support single-word commands (e.g., "zerion search")
export function registerSingle(name, handler) {
  commands.set(name, handler);
}

function printUsage() {
  const usage = {
    usage: "zerion-cli <command> [options]",
    commands: {
      "wallet create": "Create a new wallet",
      "wallet import": "Import from private key or mnemonic",
      "wallet list": "List all wallets",
      "wallet fund": "Show wallet address for funding",
      "wallet export": "Export wallet mnemonic (recovery phrase)",
      "wallet analyze <address>": "Full wallet analysis (portfolio, positions, txs, PnL)",
      "wallet portfolio <address>": "View portfolio value and positions",
      "wallet positions <address>": "View token + DeFi positions (--positions all|simple|defi)",
      "wallet transactions <address>": "View transaction history",
      "wallet pnl <address>": "View profit & loss",
      "search <query>": "Search for tokens",
      "portfolio": "View portfolio (uses --wallet or default wallet)",
      "pnl": "View profit & loss (uses --wallet or default wallet)",
      "history": "View transaction history (uses --wallet or default wallet)",
      "swap <from> <to> [amount]": "Swap tokens (supports --to-chain for cross-chain)",
      "swap tokens [chain]": "List tokens available for swap/bridge",
      "bridge <token> <chain> [amount]": "Bridge tokens cross-chain (supports --to-token)",
      "buy <token> [amount]": "Buy token with ETH",
      "sell <token> [amount]": "Sell token for ETH",
      "chains [list]": "List supported chains",
      "export": "Export wallets to Zerion app via QR code",
      "agent create-token": "Create scoped API token for an agent",
      "agent list-tokens": "List active agent tokens",
      "agent revoke-token": "Revoke an agent token",
      "agent create-policy": "Create a security policy (chain lock, expiry, allowlist)",
      "agent list-policies": "List all policies",
      "agent show-policy": "Show policy details",
      "agent delete-policy": "Delete a policy",
      "watch <address> --name <label>": "Add wallet to watchlist",
      "watch list": "List watched wallets",
      "watch remove <name>": "Remove from watchlist",
      "analyze <name|address>": "Analyze wallet trading activity",
      "config set|get|list": "Manage configuration",
    },
    flags: {
      "--wallet <name>": "Specify wallet (default: from config)",
      "--address <addr/ens>": "Use raw address or ENS name",
      "--watch <name>": "Use watched wallet by name",
      "--chain <chain>": "Specify chain (default: ethereum)",
      "--x402": "Use x402 pay-per-call (no API key needed)",
      "--json": "JSON output (default)",
      "--pretty": "Human-readable output",
      "--quiet": "Minimal output",
      "--yes": "Skip confirmation prompts",
    },
  };
  process.stdout.write(JSON.stringify(usage, null, 2) + "\n");
}

export async function dispatch(argv) {
  const { rest, flags } = parseFlags(argv);

  // Handle shorthand flags (-h, -v) that the flag parser treats as positional
  if (rest.includes("-h")) flags.help = true;
  if (rest.includes("-v")) flags.version = true;

  if (flags.version || flags.v) {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (flags.help || flags.h || rest.length === 0) {
    printUsage();
    return;
  }

  // Try "scope action" first (e.g., "wallet create")
  const twoWord = `${rest[0]} ${rest[1]}`;
  if (commands.has(twoWord)) {
    return commands.get(twoWord)(rest.slice(2), flags);
  }

  // Try single-word command (e.g., "search", "portfolio")
  if (commands.has(rest[0])) {
    return commands.get(rest[0])(rest.slice(1), flags);
  }

  printError(
    "unknown_command",
    `Unknown command: ${rest.join(" ")}`,
    { suggestion: "Run 'zerion-cli --help' to see available commands" }
  );
  process.exit(1);
}
