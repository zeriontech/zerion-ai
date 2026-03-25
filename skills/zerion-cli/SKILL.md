---
name: zerion-cli
description: "Install, configure, and troubleshoot the Zerion CLI for crypto wallet data. Use when setting up authentication, checking CLI status, or debugging connection issues. For actual wallet queries, use the wallet-analysis skill."
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

Setup, authentication, and troubleshooting for zerion-cli.

**For wallet analysis, use the `wallet-analysis` skill instead.**

## Installation

```bash
# Run without installing (recommended)
npx zerion-cli --help

# Or install globally
npm install -g zerion-cli
```

Requires Node.js 20 or later.

## Authentication

### Option A: API key (recommended for production)

```bash
export ZERION_API_KEY="zk_dev_..."
```

Get yours at [dashboard.zerion.io](https://dashboard.zerion.io).

- Dev keys start with `zk_dev_`
- Rate limits: 120 requests/minute, 5,000 requests/day
- Auth method: HTTP Basic Auth (key as username, empty password)

### Option B: x402 pay-per-call (no signup)

No API key needed. Pay $0.01 USDC per request on Base via the [x402 protocol](https://www.x402.org/).

```bash
# Per-command flag
zerion-cli wallet analyze <address> --x402

# Or set globally via environment
export ZERION_X402=true
```

The agent's wallet handles payment automatically.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERION_API_KEY` | Yes (unless x402) | API key from dashboard.zerion.io |
| `ZERION_X402` | No | Set to `true` to enable x402 pay-per-call globally |
| `ZERION_API_BASE` | No | Override API base URL (default: `https://api.zerion.io/v1`) |

## CLI help

```bash
zerion-cli --help
```

Returns JSON with all available commands, env vars, and x402 info.

## Available commands

```
zerion-cli wallet analyze <address>       # Full wallet analysis
zerion-cli wallet portfolio <address>     # Portfolio overview
zerion-cli wallet positions <address>     # Token + DeFi positions
zerion-cli wallet transactions <address>  # Transaction history
zerion-cli wallet pnl <address>           # Profit and loss
zerion-cli chains list                    # Supported chains
```

All commands accept `--x402` for pay-per-call auth.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set the env var or use `--x402` |
| `unsupported_chain` | Invalid `--chain` value | Run `zerion-cli chains list` for valid IDs |
| `api_error` status 401 | Invalid API key | Check key at dashboard.zerion.io |
| `api_error` status 429 | Rate limited | Wait, reduce request frequency, or use x402 |
| `api_error` status 400 | Invalid address format | Use 0x hex address, not ENS name |
| `unexpected_error` | Node.js version too old | Requires Node.js >= 20 |

## Resources

- API docs: [developers.zerion.io](https://developers.zerion.io)
- Dashboard: [dashboard.zerion.io](https://dashboard.zerion.io)
- x402 protocol: [x402.org](https://www.x402.org/)
- Source: [github.com/zeriontech/zerion-ai](https://github.com/zeriontech/zerion-ai)
