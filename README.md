# zerion-cli

**Maintained by Zerion.**

`zerion` is the unified, JSON-first CLI for [Zerion](https://zerion.io). It covers wallet analysis (portfolio, positions, transactions, PnL) and on-chain trading (swap, bridge, send, sign) across 14 EVM chains and Solana, plus encrypted local wallets and agent-token policy management.

## Install

```bash
npm install -g zerion
```

Or run directly without installing:

```bash
npx zerion --help
```

Requires Node.js 20 or later.

## Authentication

Three options. The CLI auto-detects which is active.

### A) API key

```bash
export ZERION_API_KEY="zk_dev_..."
```

- HTTP Basic Auth, dev keys begin with `zk_dev_`
- Current dev-key limits: **120 requests/minute**, **5k requests/day**
- Get one at [dashboard.zerion.io](https://dashboard.zerion.io)

### B) x402 pay-per-call

**No API key needed.** Pay $0.01 USDC per request via the [x402 protocol](https://www.x402.org/). Supports EVM (Base) and Solana.

> Pay-per-call applies to analytics commands only (`portfolio`, `positions`, `history`, `pnl`, `analyze`). Trading commands always use an API key.

```bash
export WALLET_PRIVATE_KEY="0x..."     # EVM (Base) — 0x-prefixed hex
export WALLET_PRIVATE_KEY="5C1y..."   # Solana — base58 encoded keypair

zerion wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
# or enable globally:
export ZERION_X402=true
```

Both chains simultaneously:

```bash
export EVM_PRIVATE_KEY="0x..."
export SOLANA_PRIVATE_KEY="5C1y..."
export ZERION_X402_PREFER_SOLANA=true   # optional, prefers Solana when both set
```

### C) MPP pay-per-call

**No API key needed.** Pay $0.01 USDC per request via the [MPP protocol](https://mpp.dev) on [Tempo](https://tempo.xyz). EVM only.

```bash
export WALLET_PRIVATE_KEY="0x..."   # EVM key with USDC on Tempo
# or use a dedicated key:
export TEMPO_PRIVATE_KEY="0x..."

zerion portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --mpp
# or enable globally:
export ZERION_MPP=true
```

## Quickstart

```bash
npm install -g zerion
export ZERION_API_KEY="zk_dev_..."
zerion wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Example output:

```json
{
  "wallet": { "query": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
  "portfolio": { "total": 450000, "currency": "usd" },
  "positions": { "count": 42 },
  "transactions": { "sampled": 10 },
  "pnl": { "available": true }
}
```

## Common commands

```bash
# Wallet analysis (read-only, supports --x402 / --mpp)
zerion analyze <address|ens|wallet-name>     # full analysis
zerion portfolio <address>                    # portfolio value + top positions
zerion positions <address>                    # token + DeFi positions
zerion history <address>                      # transaction history
zerion pnl <address>                          # profit & loss

# Trading (requires API key)
zerion swap <from> <to> <amount> --chain <chain>
zerion bridge <token> <chain> <amount> --from-chain <chain>
zerion send <token> <amount> --to <address> --chain <chain>
zerion search <query>
zerion chains

# Wallet management (interactive)
zerion wallet create --name <name>
zerion wallet import --name <name> --evm-key
zerion wallet list
zerion wallet sync --wallet <name>

# Agent tokens (autonomous trading with scoped policies)
zerion agent create-token --name <bot> --wallet <wallet>
zerion agent list-tokens
zerion agent create-policy --name <policy> --chains <list> --expires <duration>

# Signing
zerion sign-message <msg> --chain <chain>
zerion sign-typed-data --data '<json>'
```

Run `zerion --help` for the full command list and `zerion <command> --help` for per-command flags.

## Output

All commands emit JSON to stdout (default) for agent compatibility. Errors emit JSON to stderr. Use `--pretty` for human-readable output, `--quiet` for minimal.

## Example wallets

Used throughout tests and docs:

- `vitalik.eth` / `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
- ENS DAO treasury / `0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e`
- Aave collector / `0x25F2226B597E8F9514B3F68F00F494CF4F286491`

## Failure modes

The CLI handles:

- missing or invalid API key
- invalid wallet address or ENS resolution failure
- unsupported chain filter
- empty wallets / no positions
- rate limits (HTTP 429)
- upstream timeout or temporary unavailability

All errors are emitted as structured JSON on stderr with a `code` field for programmatic handling.

## License

MIT — see [LICENSE](./LICENSE).
