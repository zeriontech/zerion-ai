---
name: zerion
description: "Install, configure, and troubleshoot zerion — the unified CLI for wallet analysis and autonomous trading. Covers setup, authentication (API key, x402, agent tokens), wallet management, and the end-to-end agent workflow."
compatibility: "Requires Node.js >= 20."
license: MIT
allowed-tools: Bash
metadata:
  openclaw:
    requires:
      bins:
        - zerion
    install:
      - kind: node
        package: "zerion"
        bins: [zerion]
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
npx zerion --help

# Or install globally
npm install -g zerion
```

Requires Node.js 20 or later.

## Quick start: AI agent wallet setup

End-to-end flow to get an AI agent trading autonomously:

```bash
# 1. Set API key
export ZERION_API_KEY="zk_dev_..."

# 2. Create wallet (prompts for passphrase, confirms backup, offers agent token)
zerion wallet create --name agent-bot

# 3. Fund the wallet
zerion wallet fund --wallet agent-bot
# → shows the EVM and Solana deposit addresses

# 4. Apply security policies (optional but recommended)
zerion agent create-policy --name safe-trading \
  --chains base,arbitrum --deny-transfers --expires 7d

# 5. Trade — agent token is read from config automatically
zerion swap ETH USDC 0.01 --chain base
zerion send ETH 0.01 --to 0x... --chain base
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
zerion analyze <address> --x402

# Or enable globally
export ZERION_X402=true
```

### Agent tokens (required for trading)

Agent tokens are required for swap, bridge, and send commands. They are saved to `~/.zerion/config.json` automatically on creation.

```bash
# Create and auto-save to config
zerion agent create-token --name my-bot --wallet my-wallet

# Or create wallet (offers token setup at the end)
zerion wallet create --name my-bot
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERION_API_KEY` | Yes (unless x402) | API key from dashboard.zerion.io |
| `WALLET_PRIVATE_KEY` | Yes (for x402) | EVM private key for x402 payments on Base |
| `ZERION_X402` | No | Set `true` to enable x402 globally |
| `SOLANA_RPC_URL` | No | Custom Solana RPC (default: mainnet-beta) |
| `ETH_RPC_URL` | No | Custom Ethereum RPC (used for ENS resolution) |
| `ZERION_API_BASE` | No | Override API base URL |

## Config (`~/.zerion/config.json`)

| Key | Description |
|-----|-------------|
| `agentToken` | Trading token (auto-saved by `agent create-token`) |
| `defaultWallet` | Default wallet for all commands |
| `defaultChain` | Default chain (default: ethereum) |
| `slippage` | Default slippage % for swaps (default: 2) |

## All commands

Commands are split into two categories:

- **Agent operations** — fully automated, no interactive input. Agents should use these freely.
- **Manual operations** — require passphrase, confirmation, or interactive input. Humans must run these directly.

### Agent operations — trading

All trading commands require an agent token (set up once via manual commands below). No passphrase prompts.

```
zerion swap <from> <to> <amount>                          # Swap tokens
zerion swap <from> <to> <amount> --chain <chain>          # Specify source chain
zerion swap <from> <to> <amount> --to-chain <chain>       # Cross-chain swap
zerion swap <from> <to> <amount> --slippage <percent>     # Custom slippage tolerance
zerion swap <from> <to> <amount> --wallet <name>          # Use specific wallet
zerion swap tokens                                        # List swap-available tokens (all chains)
zerion swap tokens <chain>                                # List swap-available tokens for chain
zerion bridge <token> <chain> <amount> --from-chain <chain>  # Bridge tokens cross-chain
zerion bridge <token> <chain> <amount> --from-chain <chain> --to-token <tok>  # Bridge + swap
zerion send <token> <amount> --to <address> --chain <chain>  # Send native or ERC-20 transfer
zerion search <query>                                     # Search for tokens by name, symbol, or address
zerion search <query> --chain <chain>                     # Search within a specific chain
zerion search <query> --limit <n>                         # Limit results (default: 10)
zerion chains                                             # List all supported chains
```

### Agent operations — message & typed-data signing

Use for off-chain authorizations: SIWE login, EIP-2612 `permit`, Permit2 approvals, Seaport/OpenSea orders.
If an agent token is active, signing is unattended; otherwise the user is prompted for the wallet passphrase.

```
zerion sign-message <message> --chain <chain>              # EIP-191 (EVM) or raw ed25519 (Solana)
zerion sign-message <message> --encoding hex               # Treat <message> as hex bytes
zerion sign-message --message <text> --wallet <name>       # Explicit flags
zerion sign-typed-data --data '<json>' --chain <chain>     # EIP-712 typed data (EVM only)
zerion sign-typed-data --file <path>                       # Read typed data from file
cat typed.json | zerion sign-typed-data                    # Read typed data from stdin
```

Typed data must be a JSON object with `{ domain, types, primaryType, message }`. Include `EIP712Domain` in `types` when the signer requires it.

### Agent operations — analysis (read-only, supports --x402)

Accepts `0x...` address, ENS name, or local wallet name. Uses `--wallet` or default wallet if no argument given.

```
zerion analyze <address|name>                             # Full analysis (portfolio, positions, txs, PnL in parallel)
zerion analyze <address|name> --chain <chain>             # Filter by chain
zerion analyze <address|name> --positions all|simple|defi # Filter position type
zerion analyze <address|name> --limit <n>                 # Limit transactions (default: 10)
zerion analyze <address|name> --x402                      # Use x402 pay-per-call
zerion portfolio <address|name>                           # Portfolio value + top positions
zerion portfolio --wallet <name>                          # Specific wallet
zerion portfolio --watch <name>                           # Watched wallet by name
zerion positions <address|name>                           # Token + DeFi positions
zerion positions <address|name> --positions all|simple|defi  # Filter: all (default), simple, defi
zerion positions <address|name> --chain <chain>           # Filter by chain
zerion history <address|name>                             # Transaction history
zerion history <address|name> --limit <n>                 # Number of txs (default: 10)
zerion history <address|name> --chain <chain>             # Filter by chain
zerion pnl <address|name>                                 # Profit & loss (realized, unrealized, fees)
```

### Agent operations — wallet info & config (read-only)

```
zerion wallet list                                        # List all wallets (shows active policies)
zerion wallet list --search <query>                       # Filter by name or address
zerion wallet fund --wallet <name>                        # Show deposit addresses
zerion watch list                                         # List watched wallets
zerion agent list-tokens                                  # List agent tokens (shows policies + active status)
zerion agent list-policies                                # List all policies
zerion agent show-policy <id>                             # Show policy details
zerion agent use-token --wallet <wallet>                  # Switch active agent token by wallet
zerion config get <key>                                   # Get a single config value
zerion config list                                        # Show current configuration
```

### Manual operations — wallet setup (requires passphrase/confirmation)

These commands require interactive input and must be run by a human directly. Agents should never call these.

```
zerion wallet create --name <name>                        # Create encrypted wallet (EVM + Solana)
zerion wallet import --name <name> --evm-key              # Import from EVM private key (interactive)
zerion wallet import --name <name> --sol-key              # Import from Solana private key (interactive)
zerion wallet import --name <name> --mnemonic             # Import from seed phrase (interactive prompt)
zerion wallet backup --wallet <name>                      # Export recovery phrase (mnemonic backup)
zerion wallet delete <name>                               # Permanently delete a wallet (requires passphrase)
zerion wallet sync --wallet <name>                        # Sync wallet to Zerion app via QR code
zerion wallet sync --all                                  # Sync all wallets to Zerion app
```

### Manual operations — agent token & policy creation

```
zerion agent create-token --name <bot> --wallet <wallet>  # Interactive policy setup
zerion agent create-token --name <bot> --wallet <wallet> --policy <id>  # With existing policy
zerion agent create-token --name <bot> --wallet <wallet> --policy <id1>,<id2>  # Multiple policies
zerion agent revoke-token --name <bot>                    # Revoke by name
zerion agent revoke-token --id <id>                       # Revoke by ID
zerion agent create-policy --name <policy>                # Create policy (at least one rule required)
zerion agent create-policy --name <policy> --chains base,arbitrum  # Chain lock
zerion agent create-policy --name <policy> --expires 24h  # Expiry (e.g. 24h, 7d)
zerion agent create-policy --name <policy> --deny-transfers  # Block raw ETH/native transfers
zerion agent create-policy --name <policy> --deny-approvals  # Block ERC-20 approval calls
zerion agent create-policy --name <policy> --allowlist 0xAddr1,0xAddr2  # Allowlist-only
zerion agent create-policy --name strict \
  --chains base --expires 7d --deny-transfers --deny-approvals  # Combined rules
zerion agent delete-policy <id>                           # Delete a policy
```

### Manual operations — watchlist & config changes

```
zerion watch <address> --name <label>                     # Add wallet to watchlist (supports ENS)
zerion watch remove <name>                                # Remove from watchlist
zerion config set apiKey <key>                            # Set API key
zerion config set defaultWallet <name>                    # Set default wallet
zerion config set defaultChain <chain>                    # Set default chain
zerion config set slippage <percent>                      # Set slippage tolerance (default: 2%)
zerion config unset <key>                                 # Remove a config value (resets to default)
```

### Other
```
zerion --help                                             # Show full usage
zerion --version                                          # Show version
```

## Global flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Specify wallet (default: from config) |
| `--address <addr/ens>` | Use raw address or ENS name |
| `--watch <name>` | Use watched wallet by name |
| `--chain <chain>` | Specify chain (default: ethereum) |
| `--to-chain <chain>` | Destination chain for cross-chain swaps |
| `--from-chain <chain>` | Source chain for bridge commands |
| `--positions all\|simple\|defi` | Filter positions type |
| `--limit <n>` | Limit results (transactions, wallet list; default: 20 for list) |
| `--offset <n>` | Skip first N results (pagination for wallet list) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--x402` | Use x402 pay-per-call (no API key needed) |
| `--json` | JSON output (default) |
| `--pretty` | Human-readable output |
| `--quiet` | Minimal output |
| `--to <address>` | Recipient address for send command |
| `--timeout <seconds>` | Transaction confirmation timeout (default: 120s) |

## Output modes

All commands print JSON to stdout; errors are JSON on stderr with non-zero exit.

- `--json` — JSON output (default, agent-friendly)
- `--pretty` — Human-readable tables (auto-enabled for TTY)
- `--quiet` — Minimal output

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Key management

Wallets are encrypted with AES-256-GCM via the Open Wallet Standard (OWS) vault at `~/.ows/`. Private keys never leave the device — signing happens locally, and the Zerion API never sees your keys.

- **Agent operations** (trading + analysis): fully automated, no passphrase. Agents use these freely.
- **Manual operations** (wallet setup, token/policy creation): require passphrase or interactive input. Humans must run these.
- **Agent tokens**: Required for all trading (swap, bridge, send). Auto-saved to config on creation.
- **Config security**: `~/.zerion/config.json` is created with mode 0o600
- **Interactive key input**: `--key` prompts securely without exposing keys in shell history

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set the env var or use `--x402` |
| `no_agent_token` | No agent token for trading command | Run `zerion agent create-token --name <name> --wallet <wallet>` |
| `no_wallet` | No wallet specified and no default set | Use `--wallet <name>` or `config set defaultWallet` |
| `wallet_not_found` | Wallet name doesn't exist in OWS vault | Run `zerion wallet list` to check |
| `unsupported_chain` | Invalid `--chain` value | Run `zerion chains` for valid IDs |
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
