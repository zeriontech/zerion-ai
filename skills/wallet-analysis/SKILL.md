---
name: wallet-analysis
description: "Analyze any crypto wallet: portfolio value, token holdings, DeFi positions, transactions, and PnL. Supports 50+ EVM chains and Solana."
compatibility: "Requires zerion-cli (`npx zerion-cli` or `npm install -g zerion-cli`). Set ZERION_API_KEY or use --x402 for pay-per-call."
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

# Wallet Analysis

Analyze crypto wallets using the zerion-cli. Returns structured JSON with portfolio overview, top positions, recent transactions, and PnL.

## Setup check

```bash
which zerion-cli || npm install -g zerion-cli
```

## Authentication

Two options:

### API key (recommended for production)

```bash
export ZERION_API_KEY="zk_dev_..."
```

Get yours at [dashboard.zerion.io](https://dashboard.zerion.io). Rate limits: 120 req/min, 5K req/day.

### x402 pay-per-call (no signup)

```bash
zerion-cli wallet analyze <address> --x402
```

Pays $0.01 USDC per request on Base. No API key needed -- the agent's wallet handles payment automatically via the [x402 protocol](https://www.x402.org/).

## When to use

Use this skill when the user asks about:
- Wallet balances or portfolio value
- Token holdings or DeFi positions
- Transaction history or recent activity
- Profit and loss (PnL)
- What chains a wallet is active on

## Commands

### Full analysis (recommended starting point)

```bash
zerion-cli wallet analyze <address> [--positions all|simple|defi] [--chain <chain>] [--limit <n>] [--x402]
```

Fetches portfolio, positions, transactions, and PnL in parallel. Returns a structured summary with:
- Portfolio total + chain breakdown + 1-day change
- Top 10 positions by value (name, symbol, value, quantity, chain)
- 5 most recent transactions with parsed transfers
- PnL summary (realized, unrealized, total)

### Portfolio overview

```bash
zerion-cli wallet portfolio <address> [--x402]
```

Total wallet value, breakdown by chain, and 1-day change.

### Positions (token holdings + DeFi)

```bash
zerion-cli wallet positions <address> [--chain <chain>] [--positions all|simple|defi] [--x402]
```

Position filters:
- `all` (default) -- wallet tokens + DeFi positions
- `simple` -- wallet token balances only
- `defi` -- DeFi protocol positions only (staked, deposited, LP, borrowed)

### Transaction history

```bash
zerion-cli wallet transactions <address> [--limit <n>] [--chain <chain>] [--x402]
```

Returns interpreted transactions with parsed actions (trade, receive, send, mint, approve, etc.). Default limit: 10.

### Profit and loss

```bash
zerion-cli wallet pnl <address> [--x402]
```

Realized gains, unrealized gains, total invested, fees, and relative percentages.

## Typical workflow

1. Check CLI: `which zerion-cli || npm install -g zerion-cli`
2. Run full analysis: `zerion-cli wallet analyze <address>`
3. If the user wants detail on a specific area, use individual commands:
   - DeFi-only: `zerion-cli wallet positions <address> --positions defi`
   - Chain-specific: `zerion-cli wallet positions <address> --chain ethereum`
   - More transactions: `zerion-cli wallet transactions <address> --limit 25`

## Output format

All output is JSON on stdout. Errors are JSON on stderr with `{ "error": { "code": "...", "message": "..." } }`.

## Supported chains

ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, scroll, linea, zksync, solana, zora, blast -- and 40+ more EVM chains.

Use `zerion-cli chains list` to see the full list.

## Best practices

1. **Start with `wallet analyze`** -- it fetches everything in parallel and returns a concise summary
2. **Use individual commands for targeted queries** -- e.g., `wallet positions --positions defi` when the user only cares about DeFi
3. **Address format**: use 0x hex addresses. ENS names are not currently supported by the API -- resolve them first
4. **Chain filter**: use `--chain` to narrow results when the user mentions a specific chain
5. **Rate limits**: 120 req/min with API key. Use `--x402` as fallback if rate-limited

## Troubleshooting

- **`missing_api_key`**: Set `ZERION_API_KEY` or add `--x402` flag
- **`unsupported_chain`**: Run `zerion-cli chains list` to check valid chain IDs
- **Empty positions/transactions**: Wallet may be inactive or very new
- **`api_error` with status 429**: Rate limited -- wait or switch to x402
- **ENS names fail with 400**: Resolve ENS to a hex address before querying

For worked examples, see [EXAMPLES.md](EXAMPLES.md).
