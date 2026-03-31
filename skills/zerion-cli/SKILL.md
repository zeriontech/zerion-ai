---
name: zerion-cli
description: "Install, configure, and troubleshoot zerion-cli — the unified CLI for wallet analysis and autonomous trading. Covers setup, authentication (API key, x402, agent tokens), wallet management, and the end-to-end agent workflow."
compatibility: "Requires Node.js >= 20."
license: MIT
allowed-tools: Bash
metadata:
  openclaw:
    requires:
      bins:
        - zerion-cli
    install:
      - kind: node
        package: "zerion-cli"
        bins: [zerion-cli]
    homepage: https://github.com/zeriontech/zerion-ai
---

# Zerion CLI

Unified CLI for wallet analysis and autonomous trading across 14 chains.

**Deep-dive skills:**
- `wallet-analysis` — portfolio, positions, transactions, PnL queries
- `wallet-trading` — swap, bridge, buy/sell, agent tokens, security policies

## Installation

```bash
# Run without installing
npx zerion-cli --help

# Or install globally
npm install -g zerion-cli
```

Requires Node.js 20 or later.

## Quick start: AI agent wallet setup

End-to-end flow to get an AI agent trading autonomously:

```bash
# 1. Set API key
export ZERION_API_KEY="zk_dev_..."

# 2. Create a wallet
zerion-cli wallet create --name agent-bot

# 3. Set it as default
zerion-cli config set defaultWallet agent-bot

# 4. Fund the wallet
zerion-cli wallet fund
# → shows the EVM and Solana deposit addresses

# 5. Create an agent token (bypasses passphrase for unattended trading)
zerion-cli agent create-token --name agent-bot --wallet agent-bot

# 6. Set the token for headless operation
export ZERION_AGENT_TOKEN=ows_key_...

# 7. Apply security policies
zerion-cli agent create-policy --name safe-trading \
  --chains base,arbitrum --deny-transfers --expires 7d

# 8. Trade
zerion-cli swap ETH USDC 0.01 --yes
```

## Authentication

Three modes, from simplest to most secure:

### API key (recommended start)

```bash
export ZERION_API_KEY="zk_dev_..."
```

Get yours at [dashboard.zerion.io](https://dashboard.zerion.io). Dev keys start with `zk_dev_`. Rate limits: 120 req/min, 5K req/day.

### x402 pay-per-call (no signup, read-only)

Pay $0.01 USDC per request on Base. No API key needed.

```bash
export WALLET_PRIVATE_KEY="0x..."
zerion-cli wallet analyze <address> --x402

# Or enable globally
export ZERION_X402=true
```

### Agent tokens (unattended trading)

Scoped tokens that bypass passphrase prompts. Attach security policies to limit what they can do.

```bash
zerion-cli agent create-token --name my-bot --wallet my-wallet
export ZERION_AGENT_TOKEN=ows_key_...
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERION_API_KEY` | Yes (unless x402) | API key from dashboard.zerion.io |
| `ZERION_AGENT_TOKEN` | No | Agent token for unattended trading |
| `WALLET_PRIVATE_KEY` | Yes (for x402) | EVM private key for x402 payments on Base |
| `ZERION_X402` | No | Set `true` to enable x402 globally |
| `SOLANA_RPC_URL` | No | Custom Solana RPC (default: mainnet-beta) |
| `ZERION_API_BASE` | No | Override API base URL |

## All commands

### Wallet management
```
zerion-cli wallet create --name <name>              # Create encrypted wallet (EVM + Solana)
zerion-cli wallet import --name <name> --key        # Import from private key (interactive)
zerion-cli wallet import --name <name> --key-file <path>  # Import from file (safest)
zerion-cli wallet import --name <name> --mnemonic   # Import from seed phrase
zerion-cli wallet list                              # List all wallets
zerion-cli wallet fund                              # Show deposit addresses
zerion-cli wallet backup --wallet <name>            # Export recovery phrase (mnemonic)
zerion-cli wallet delete <name>                     # Permanently delete a wallet
zerion-cli wallet sync --wallet <name>              # Sync wallet to Zerion app via QR
zerion-cli wallet sync --all                        # Sync all wallets to Zerion app
```

### Wallet analysis (read — supports --x402)
```
zerion-cli wallet analyze <address>                 # Full analysis (parallel fetch)
zerion-cli wallet portfolio <address>               # Portfolio value + positions
zerion-cli wallet positions <address>               # Token + DeFi positions
  --positions all|simple|defi                       #   Filter: all (default), simple, defi
  --chain <chain>                                   #   Filter by chain
zerion-cli wallet transactions <address>            # Transaction history
  --limit <n>                                       #   Number of txs (default: 10)
  --chain <chain>                                   #   Filter by chain
zerion-cli wallet pnl <address>                     # Profit & loss
```

Shorthand (uses --wallet or default wallet instead of address):
```
zerion-cli portfolio [--wallet <name>] [--address <addr>]
zerion-cli pnl [--wallet <name>] [--address <addr>]
zerion-cli history [--wallet <name>] [--address <addr>]
```

### Trading
```
zerion-cli swap <from> <to> <amount>                # Quote
zerion-cli swap <from> <to> <amount> --yes          # Execute
zerion-cli swap <from> <to> <amount> --to-chain <chain> --yes  # Cross-chain
zerion-cli bridge <token> <chain> <amount> --yes    # Bridge
zerion-cli bridge <token> <chain> <amount> --to-token <tok> --yes  # Bridge + swap
zerion-cli search <query>                           # Token search
zerion-cli swap tokens [chain]                      # List swap-available tokens
zerion-cli chains                                   # List supported chains
```

### Agent tokens
```
zerion-cli agent create-token --name <bot> --wallet <wallet>
zerion-cli agent list-tokens
zerion-cli agent revoke-token --name <bot>
```

### Security policies
```
zerion-cli agent create-policy --name <policy>
  --chains base,arbitrum                            # Chain lock
  --expires 24h | 7d                                # Expiry
  --deny-transfers                                  # Block raw ETH transfers
  --deny-approvals                                  # Block ERC-20 approvals
  --allowlist 0xAddr1,0xAddr2                       # Allowlist-only
zerion-cli agent list-policies
zerion-cli agent show-policy <id>
zerion-cli agent delete-policy <id>
```

### Watchlist & analysis
```
zerion-cli watch <address> --name <label>           # Add to watchlist
zerion-cli watch list                               # List watched wallets
zerion-cli watch remove <name>                      # Remove
zerion-cli analyze <name|address>                   # Analyze trading activity
```

### Config
```
zerion-cli config set apiKey <key>                  # Set API key
zerion-cli config set defaultWallet <name>          # Set default wallet
zerion-cli config set defaultChain <chain>          # Set default chain
zerion-cli config set slippage <percent>            # Set slippage (default: 2%)
zerion-cli config list                              # Show current config
```

## Output modes

- `--json` — JSON output (default, agent-friendly)
- `--pretty` — Human-readable tables (auto-enabled for TTY)
- `--quiet` — Minimal output
- `--yes` — Skip confirmation prompts (required for trade execution)

All outputs are JSON on stdout; errors are JSON on stderr.

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Key management

Wallets are encrypted with AES-256-GCM via the Open Wallet Standard (OWS) vault at `~/.ows/`. Private keys never leave the device — signing happens locally, and the Zerion API never sees your keys.

- **Passphrase**: Required for wallet creation and transaction signing
- **Agent tokens**: Bypass passphrase for bot/agent use (scoped, revocable)
- **Key-file import**: `--key-file <path>` avoids exposing keys in shell history
- **Config security**: `~/.zerion-cli/config.json` is created with mode 0o600

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set the env var or use `--x402` |
| `no_wallet` | No wallet specified and no default set | Use `--wallet <name>` or `config set defaultWallet` |
| `wallet_not_found` | Wallet name doesn't exist in OWS vault | Run `zerion-cli wallet list` to check |
| `unsupported_chain` | Invalid `--chain` value | Run `zerion-cli chains` for valid IDs |
| `unsupported_positions_filter` | Invalid `--positions` value | Use `all`, `simple`, or `defi` |
| `api_error` status 401 | Invalid API key | Check key at dashboard.zerion.io |
| `api_error` status 429 | Rate limited | Wait, reduce frequency, or use x402 |
| `api_error` status 400 | Invalid address or ENS failed | Retry with 0x hex address |
| `unexpected_error` | `WALLET_PRIVATE_KEY` missing in x402 | Export the private key or disable x402 |
| `unexpected_error` | Node.js < 20 | Upgrade Node.js |

## Resources

- API docs: [developers.zerion.io](https://developers.zerion.io)
- Dashboard: [dashboard.zerion.io](https://dashboard.zerion.io)
- x402 protocol: [x402.org](https://www.x402.org/)
- Source: [github.com/zeriontech/zerion-ai](https://github.com/zeriontech/zerion-ai)
