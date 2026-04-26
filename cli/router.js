/**
 * Command router — maps "scope action" to handler functions.
 * Pattern: zerion <scope> <action> [args...] [--flags]
 */

import { parseFlags } from "./lib/util/flags.js";
import { printError } from "./lib/util/output.js";

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
    usage: "zerion <command> [options]",
    wallet_management: {
      "wallet create --name <name>": "Create encrypted wallet (EVM + Solana)",
      "wallet import --name <name> --evm-key": "Import from EVM private key (interactive)",
      "wallet import --name <name> --sol-key": "Import from Solana private key (interactive)",
      "wallet import --name <name> --mnemonic": "Import from seed phrase (all chains)",
      "wallet list": "List all wallets",
      "wallet fund": "Show deposit addresses for funding",
      "wallet backup --wallet <name>": "Export recovery phrase (mnemonic backup)",
      "wallet delete <name>": "Permanently delete a wallet (requires passphrase)",
      "wallet sync --wallet <name>": "Sync wallet to Zerion app via QR code",
      "wallet sync --all": "Sync all wallets to Zerion app",
    },
    signing: {
      "sign-message <message> --chain <chain>": "Sign an EIP-191 (EVM) or raw (Solana) message",
      "sign-message <message> --encoding hex": "Treat message as hex bytes",
      "sign-typed-data --data '<json>'": "Sign EIP-712 typed data (EVM only)",
      "sign-typed-data --file <path>": "Read EIP-712 typed data from file",
      "cat typed.json | sign-typed-data": "Read EIP-712 typed data from stdin",
    },
    analysis: {
      "analyze <address|name>": "Full analysis (portfolio, positions, txs, PnL in parallel)",
      "portfolio <address|name>": "Portfolio value and top positions",
      "positions <address|name>": "Token + DeFi positions (--positions all|simple|defi)",
      "history <address|name>": "Transaction history (--limit <n>, --chain <chain>)",
      "pnl <address|name>": "Profit & loss (realized, unrealized, fees)",
    },
    trading: {
      "swap <from> <to> <amount>": "Swap tokens",
      "swap <from> <to> <amount> --to-chain <chain>": "Cross-chain swap",
      "swap tokens [chain]": "List tokens available for swap",
      "bridge <token> <chain> <amount>": "Bridge tokens cross-chain",
      "bridge <token> <chain> <amount> --to-token <tok>": "Bridge + swap on destination",
      "search <query>": "Search for tokens by name or symbol",
    },
    agent_tokens: {
      "agent create-token --name <bot> --wallet <wallet>": "Create scoped API token for unattended trading",
      "agent list-tokens": "List active agent tokens",
      "agent use-token --wallet <wallet>": "Switch active agent token by wallet",
      "agent revoke-token --name <bot>": "Revoke an agent token",
      "_usage": "Token is saved to config automatically. Required for swap/bridge/send.",
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
      "config unset <key>": "Remove a config value (resets to default)",
      "config list": "Show current configuration",
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
      "--x402": "Use x402 pay-per-call on Base or Solana — analytics commands only (no API key needed)",
      "--mpp": "Use MPP pay-per-call on Tempo — analytics commands only (no API key needed)",
      "--json": "JSON output (default)",
      "--pretty": "Human-readable output",
      "--quiet": "Minimal output",
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
      "WALLET_PRIVATE_KEY": "Private key for pay-per-call: 0x-hex → x402 on Base; base58 → x402 on Solana; 0x-hex → also works for MPP",
      "EVM_PRIVATE_KEY": "EVM private key for x402 on Base (overrides WALLET_PRIVATE_KEY for EVM)",
      "SOLANA_PRIVATE_KEY": "Solana private key for x402 on Solana (overrides WALLET_PRIVATE_KEY for Solana)",
      "TEMPO_PRIVATE_KEY": "EVM private key for MPP on Tempo (overrides WALLET_PRIVATE_KEY for MPP)",
      "ZERION_X402": "Set 'true' to enable x402 globally (analytics commands only)",
      "ZERION_X402_PREFER_SOLANA": "Set 'true' to prefer Solana over Base when both keys are set",
      "ZERION_MPP": "Set 'true' to enable MPP globally (analytics commands only)",
      "SOLANA_RPC_URL": "Custom Solana RPC endpoint",
      "ETH_RPC_URL": "Custom Ethereum RPC endpoint (used for ENS resolution)",
    },
    config: {
      "agentToken": "Trading token (auto-saved by `agent create-token`)",
      "defaultWallet": "Default wallet for all commands",
      "defaultChain": "Default chain (default: ethereum)",
      "slippage": "Default slippage % for swaps (default: 2)",
    },
    setup: {
      "setup skills": "Install Zerion agent skills via `npx skills add zeriontech/zerion-agent` (45+ hosts)",
      "setup mcp --agent <name>": "Write the Zerion hosted-MCP fragment into a detected agent's config (cursor, claude-code, claude-desktop)",
      "setup mcp --print": "Print the canonical MCP fragment to stdout",
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
    { suggestion: "Run 'zerion --help' to see available commands" }
  );
  process.exit(1);
}
