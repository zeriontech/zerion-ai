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
# Option A: API key via interactive login (browser or paste)
zerion login --browser        # opens dashboard, auto-saves key
zerion login --api-key zk-... # non-interactive
zerion logout                 # clear saved key + agent tokens

# Or set the env var directly (takes precedence over saved config)
export ZERION_API_KEY="zk_dev_..."

# Option B: x402 pay-per-call (no API key needed)
export WALLET_PRIVATE_KEY="0x..."
zerion wallet analyze <address> --x402

# Agent token for trading (auto-saved to config)
zerion agent create-token --name my-bot --wallet my-wallet
```

## Commands

Commands are split into **agent operations** (fully automated, no interactive input) and **manual operations** (require passphrase or confirmation — humans must run these directly).

### Agent operations — trading

All trading commands require an agent token (set up once via manual commands below). No passphrase prompts.

```
zerion swap <from> <to> <amount>                             Swap tokens
zerion swap <from> <to> <amount> --chain <chain>             Specify source chain
zerion swap <from> <to> <amount> --to-chain <chain>          Cross-chain swap
zerion swap <from> <to> <amount> --slippage <percent>        Custom slippage
zerion swap tokens [chain]                                   List tokens available for swap
zerion bridge <token> <chain> <amount> --from-chain <chain>  Bridge tokens cross-chain
zerion bridge <token> <chain> <amount> --from-chain <chain> --to-token <tok>  Bridge + swap
zerion send <token> <amount> --to <address> --chain <chain>  Send native or ERC-20 transfer
zerion search <query>                                        Search for tokens by name or symbol
zerion chains                                                List supported chains
```

### Agent operations — analysis (read-only, supports --x402)

Accepts `0x...` address, ENS name (e.g., `vitalik.eth`), or local wallet name. Uses `--wallet` or default wallet if no argument given.

```
zerion analyze <address|name>        Full analysis (portfolio, positions, txs, PnL in parallel)
zerion portfolio <address|name>      Portfolio value and top positions
zerion positions <address|name>      Token + DeFi positions (--positions all|simple|defi)
zerion history <address|name>        Transaction history (--limit <n>, --chain <chain>)
zerion pnl <address|name>            Profit & loss (realized, unrealized, fees)
```

### Agent operations — wallet info & status (read-only)

```
zerion wallet list                                           List wallets (shows active policies)
zerion wallet list --search <query>                          Filter by name or address
zerion wallet fund --wallet <name>                           Show deposit addresses
zerion watch list                                            List watched wallets
zerion agent list-tokens                                     List agent tokens (policies + active status)
zerion agent list-policies                                   List all policies
zerion agent show-policy <id>                                Show policy details
zerion agent use-token --wallet <wallet>                     Switch active agent token
zerion config get <key>                                      Get a config value
zerion config list                                           Show current configuration
```

### Manual operations — wallet setup (requires passphrase)

These require interactive input. Agents should not call these.

```
zerion wallet create --name <name>                           Create encrypted wallet (EVM + Solana)
zerion wallet import --name <name> --evm-key                 Import from EVM private key (interactive)
zerion wallet import --name <name> --sol-key                 Import from Solana private key (interactive)
zerion wallet import --name <name> --mnemonic                Import from seed phrase (interactive)
zerion wallet backup --wallet <name>                         Export recovery phrase (requires passphrase)
zerion wallet delete <name>                                  Delete wallet (requires passphrase + confirmation)
zerion wallet sync --wallet <name>                           Sync to Zerion app via QR code
zerion wallet sync --all                                     Sync all wallets
```

### Manual operations — agent tokens & policies

```
zerion agent create-token --name <bot> --wallet <wallet>     Create token (interactive policy setup)
zerion agent create-token --name <bot> --wallet <w> --policy <id>  Create with existing policy
zerion agent revoke-token --name <bot>                       Revoke an agent token
zerion agent create-policy --name <policy>                   Create security policy
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

### Manual operations — watchlist & config changes

```
zerion watch <address> --name <label>    Add wallet to watchlist
zerion watch remove <name>               Remove from watchlist
zerion config set apiKey <key>           Set API key
zerion config set defaultWallet <name>   Set default wallet
zerion config set defaultChain <chain>   Set default chain
zerion config set slippage <percent>     Set slippage tolerance (default: 2%)
zerion config unset <key>                Remove a config value
```

### Other

```
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
| `--from-chain <chain>` | Source chain for bridge commands |
| `--to <address>` | Recipient address for send command |
| `--to-token <token>` | Destination token for bridge + swap |
| `--timeout <seconds>` | Transaction confirmation timeout (default: 120s) |
| `--positions all\|simple\|defi` | Filter positions type |
| `--limit <n>` | Limit results (default: 20 for wallet list) |
| `--offset <n>` | Skip first N results (pagination) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--x402` | Use x402 pay-per-call (no API key needed) |
| `--json` | JSON output (default) |
| `--pretty` | Human-readable output |
| `--quiet` | Minimal output |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERION_API_KEY` | Yes (unless x402) | API key from dashboard.zerion.io |
| `ZERION_AGENT_TOKEN` | No | Agent token for unattended trading |
| `WALLET_PRIVATE_KEY` | Yes (for x402) | EVM private key for x402 payments on Base |
| `ZERION_X402` | No | Set `true` to enable x402 globally |
| `SOLANA_RPC_URL` | No | Custom Solana RPC endpoint |
| `ETH_RPC_URL` | No | Custom Ethereum RPC endpoint (ENS resolution) |

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
