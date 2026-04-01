/**
 * Command router — maps "scope action" to handler functions.
 * Pattern: zerion-cli <scope> <action> [args...] [--flags]
 */

import { parseFlags } from "./lib/util/flags.js";
import { printError } from "./lib/util/output.js";

const commands = new Map();

export function register(scope, action, handler) {
  commands.set(`${scope} ${action}`, handler);
}

// Also support single-word commands (e.g., "zerion-cli search")
export function registerSingle(name, handler) {
  commands.set(name, handler);
}

function printUsage() {
  const usage = {
    usage: "zerion-cli <command> [options]",
    wallet_management: {
      "wallet create --name <name>": "Create encrypted wallet (EVM + Solana)",
      "wallet import --name <name> --key": "Import from private key (interactive prompt)",
      "wallet import --name <name> --key-file <path>": "Import from file (safest)",
      "wallet import --name <name> --mnemonic": "Import from seed phrase",
      "wallet list": "List all wallets",
      "wallet fund": "Show deposit addresses for funding",
      "wallet backup --wallet <name>": "Export recovery phrase (mnemonic backup)",
      "wallet delete <name>": "Permanently delete a wallet (requires passphrase)",
      "wallet sync --wallet <name>": "Sync wallet to Zerion app via QR code",
      "wallet sync --all": "Sync all wallets to Zerion app",
    },
    wallet_analysis: {
      "wallet analyze <address>": "Full analysis (portfolio, positions, txs, PnL in parallel)",
      "wallet portfolio <address>": "Portfolio value and top positions",
      "wallet positions <address>": "Token + DeFi positions (--positions all|simple|defi)",
      "wallet transactions <address>": "Transaction history (--limit <n>, --chain <chain>)",
      "wallet pnl <address>": "Profit & loss (realized, unrealized, fees)",
    },
    trading: {
      "swap <from> <to> <amount>": "Swap tokens (quote only; add --yes to execute)",
      "swap <from> <to> <amount> --to-chain <chain>": "Cross-chain swap",
      "swap tokens [chain]": "List tokens available for swap",
      "bridge <token> <chain> <amount>": "Bridge tokens cross-chain",
      "bridge <token> <chain> <amount> --to-token <tok>": "Bridge + swap on destination",
      "search <query>": "Search for tokens by name or symbol",
    },
    agent_tokens: {
      "agent create-token --name <bot> --wallet <wallet>": "Create scoped API token for unattended trading",
      "agent list-tokens": "List active agent tokens",
      "agent revoke-token --name <bot>": "Revoke an agent token",
      "_usage": "Set ZERION_AGENT_TOKEN=ows_key_... to bypass passphrase prompts",
    },
    agent_policies: {
      "agent create-policy --name <policy>": "Create security policy (see policy flags below)",
      "agent list-policies": "List all policies",
      "agent show-policy <id>": "Show policy details",
      "agent delete-policy <id>": "Delete a policy",
    },
    watchlist: {
      "watch <address> --name <label>": "Add wallet to watchlist",
      "watch list": "List watched wallets",
      "watch remove <name>": "Remove from watchlist",
      "analyze <name|address>": "Analyze wallet trading activity",
    },
    other: {
      "chains": "List supported chains",
      "config set <key> <value>": "Set config (apiKey, defaultWallet, defaultChain, slippage)",
      "config list": "Show current configuration",
      "portfolio": "Portfolio (shorthand, uses --wallet or default)",
      "positions": "Positions (shorthand, uses --wallet or default)",
      "pnl": "PnL (shorthand, uses --wallet or default)",
      "history": "Tx history (shorthand, uses --wallet or default)",
    },
    flags: {
      "--wallet <name>": "Specify wallet (default: from config)",
      "--address <addr/ens>": "Use raw address or ENS name",
      "--watch <name>": "Use watched wallet by name",
      "--chain <chain>": "Specify chain (default: ethereum)",
      "--to-chain <chain>": "Destination chain for cross-chain swaps",
      "--positions all|simple|defi": "Filter positions type",
      "--limit <n>": "Limit results (transactions, wallet list; default: 20 for list)",
      "--offset <n>": "Skip first N results (pagination for wallet list)",
      "--search <query>": "Filter wallets by name or address",
      "--slippage <percent>": "Slippage tolerance (default: 2%)",
      "--x402": "Use x402 pay-per-call (no API key needed)",
      "--json": "JSON output (default)",
      "--pretty": "Human-readable output",
      "--quiet": "Minimal output",
      "--yes": "Skip confirmation prompts (required to execute trades)",
    },
    policy_flags: {
      "--chains <list>": "Restrict to specific chains (comma-separated)",
      "--expires <duration>": "Token expiry (e.g. 24h, 7d)",
      "--deny-transfers": "Block raw ETH/native transfers",
      "--deny-approvals": "Block ERC-20 approval calls",
      "--allowlist <addresses>": "Only allow interaction with listed addresses",
    },
    env: {
      "ZERION_API_KEY": "API key (get at dashboard.zerion.io)",
      "ZERION_AGENT_TOKEN": "Agent token for unattended trading",
      "WALLET_PRIVATE_KEY": "EVM key for x402 pay-per-call",
      "ZERION_X402": "Set 'true' to enable x402 globally",
      "SOLANA_RPC_URL": "Custom Solana RPC endpoint",
    },
    chains: [
      "ethereum", "base", "arbitrum", "optimism", "polygon",
      "binance-smart-chain", "avalanche", "gnosis", "scroll",
      "linea", "zksync-era", "zora", "blast", "solana"
    ],
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
