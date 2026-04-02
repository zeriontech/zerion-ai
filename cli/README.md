# zerion

`zerion` is the JSON-first CLI for using Zerion from AI agents, developer tools, and command-based runtimes.

## Install

```bash
npm install -g zerion
```

Or run directly:

```bash
npx zerion --help
```

Requires Node.js 20 or later.

## Authentication

See the [root README](../README.md#1-choose-your-authentication-method) for full auth setup (API key, x402, agent tokens).

```bash
# Option A: API key
export ZERION_API_KEY="zk_dev_..."

# Option B: x402 pay-per-call (no API key needed)
export WALLET_PRIVATE_KEY="0x..."
zerion wallet analyze <address> --x402

# Agent token for trading (auto-saved to config)
zerion agent create-token --name my-bot --wallet my-wallet
```

## Commands

### Wallet management

```
zerion wallet create --name <name>                        Create encrypted wallet (EVM + Solana)
zerion wallet import --name <name> --key                  Import from private key (interactive prompt)
zerion wallet import --name <name> --key-file <path>      Import from file (safest)
zerion wallet import --name <name> --mnemonic             Import from seed phrase
zerion wallet import --name <name> --mnemonic-file <path> Import from mnemonic file
zerion wallet list                                        List all wallets
zerion wallet fund                                        Show deposit addresses for funding
zerion wallet backup --wallet <name>                      Export recovery phrase (mnemonic backup)
zerion wallet delete <name>                               Permanently delete a wallet (requires passphrase)
zerion wallet sync --wallet <name>                        Sync wallet to Zerion app via QR code
zerion wallet sync --all                                  Sync all wallets to Zerion app
```

### Wallet analysis

```
zerion wallet analyze <address>      Full analysis (portfolio, positions, txs, PnL in parallel)
zerion wallet portfolio <address>    Portfolio value and top positions
zerion wallet positions <address>    Token + DeFi positions (--positions all|simple|defi)
zerion wallet transactions <address> Transaction history (--limit <n>, --chain <chain>)
zerion wallet pnl <address>          Profit & loss (realized, unrealized, fees)
```

Addresses can be `0x...` hex or ENS names (e.g., `vitalik.eth`).

#### Shorthands

These use `--wallet` or the default wallet instead of a positional address:

```
zerion portfolio                     Portfolio (shorthand)
zerion positions                     Positions (shorthand)
zerion pnl                           PnL (shorthand)
zerion history                       Transaction history (shorthand)
```

### Trading

All trading commands require an agent token (see below).

```
zerion swap <from> <to> <amount>                             Swap tokens (quote only)
zerion swap <from> <to> <amount> --yes                       Execute the swap
zerion swap <from> <to> <amount> --to-chain <chain>          Cross-chain swap
zerion swap <from> <to> <amount> --to-chain <chain> --yes    Execute cross-chain swap
zerion swap tokens [chain]                                   List tokens available for swap
zerion bridge <token> <chain> <amount>                       Bridge tokens (quote only)
zerion bridge <token> <chain> <amount> --yes                 Execute bridge
zerion bridge <token> <chain> <amount> --to-token <tok>      Bridge + swap on destination
zerion send <token> <amount> --to <address>                  Send tokens (quote only)
zerion send <token> <amount> --to <address> --yes            Execute native or ERC-20 transfer
zerion search <query>                                        Search for tokens by name or symbol
```

### Agent tokens

Required for all trading commands (swap, bridge, send). Auto-saved to config on creation.

```
zerion agent create-token --name <bot> --wallet <wallet>     Create token (saved to config)
zerion wallet create --name <bot> --agent                    Create wallet + token in one shot
zerion agent list-tokens                                     List active agent tokens
zerion agent revoke-token --name <bot>                       Revoke an agent token
```

### Security policies

Restrict what agent tokens can do:

```
zerion agent create-policy --name <policy>                   Create security policy
zerion agent list-policies                                   List all policies
zerion agent show-policy <id>                                Show policy details
zerion agent delete-policy <id>                              Delete a policy
```

Policy flags (for `create-policy`):

```
--chains <list>              Restrict to specific chains (comma-separated)
--expires <duration>         Token expiry (e.g. 24h, 7d)
--deny-transfers             Block raw ETH/native transfers
--deny-approvals             Block ERC-20 approval calls
--allowlist <addresses>      Only allow interaction with listed addresses
```

### Watchlist

```
zerion watch <address> --name <label>    Add wallet to watchlist
zerion watch list                        List watched wallets
zerion watch remove <name>               Remove from watchlist
zerion analyze <name|address>            Analyze wallet trading activity
```

### Config

```
zerion config set apiKey <key>           Set API key
zerion config set defaultWallet <name>   Set default wallet
zerion config set defaultChain <chain>   Set default chain
zerion config set slippage <percent>     Set slippage tolerance (default: 2%)
zerion config list                       Show current configuration
```

### Other

```
zerion chains                            List supported chains
zerion --help                            Show usage
zerion --version                         Show version
```

## Global flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Specify wallet (default: from config) |
| `--address <addr/ens>` | Use raw address or ENS name |
| `--watch <name>` | Use watched wallet by name |
| `--chain <chain>` | Specify chain (default: ethereum) |
| `--to-chain <chain>` | Destination chain for cross-chain swaps |
| `--positions all\|simple\|defi` | Filter positions type |
| `--limit <n>` | Limit results (default: 20 for wallet list) |
| `--offset <n>` | Skip first N results (pagination) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--x402` | Use x402 pay-per-call (no API key needed) |
| `--json` | JSON output (default) |
| `--pretty` | Human-readable output |
| `--quiet` | Minimal output |
| `--yes` | Skip confirmation prompts (required to execute trades) |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERION_API_KEY` | Yes (unless x402) | API key from dashboard.zerion.io |
| `ZERION_AGENT_TOKEN` | No | Agent token for unattended trading |
| `WALLET_PRIVATE_KEY` | Yes (for x402) | EVM private key for x402 payments on Base |
| `ZERION_X402` | No | Set `true` to enable x402 globally |
| `SOLANA_RPC_URL` | No | Custom Solana RPC endpoint |

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Output format

- All commands print JSON to stdout
- Errors are JSON on stderr and exit non-zero
- `--pretty` enables human-readable tables (auto-enabled for TTY)

## Error handling

| Error | Cause | Fix |
|-------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set the env var or use `--x402` |
| `no_wallet` | No wallet specified and no default | Use `--wallet <name>` or `config set defaultWallet` |
| `wallet_not_found` | Wallet name doesn't exist in vault | Run `zerion wallet list` |
| `unsupported_chain` | Invalid `--chain` value | Run `zerion chains` |
| `invalid_agent_token` | Agent token revoked or invalid | Create a new one with `zerion agent create-token` |
| `api_error` 401 | Invalid API key | Check key at dashboard.zerion.io |
| `api_error` 429 | Rate limited | Wait and retry, or use x402 |
