---
name: zerion
description: "Crypto wallet API + CLI for AI agents — install, authentication, and routing to specific Zerion capabilities. Use this skill for setup or to learn which `zerion-*` skill applies; deep-dive skills handle individual capabilities (analyze, trade, sign, manage wallets, manage agent tokens)."
license: MIT
allowed-tools: Bash
---

# Zerion

Unified API + CLI for crypto wallets across 14 EVM chains and Solana. The `zerion` binary ships from npm; this skill is the entry point for install, authentication, and routing to specific capability skills.

## Setup

Skills shell out to the `zerion` binary. Don't pre-install — try the command first. If a `zerion` invocation fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. The npm package is `zerion-cli`; the installed binary is `zerion`.

## Authentication

Three modes. Pick one for analytics; trading always uses an API key.

### A) API key (recommended)

Run the browser-based login flow — opens [dashboard.zerion.io](https://dashboard.zerion.io), waits for the user to click **Authorize**, and saves the key automatically (PKCE; no manual paste):

```bash
zerion login              # browser-based PKCE flow, saves to ~/.zerion/config.json
zerion logout             # clear saved key + agent tokens
```

For non-interactive contexts (CI, scripts, headless agents) supply the key directly:

```bash
zerion login --api-key zk_dev_...   # save a key non-interactively
export ZERION_API_KEY="zk_dev_..."  # or just export it; CLI auto-detects
```

Get a key at [dashboard.zerion.io](https://dashboard.zerion.io). Dev keys begin with `zk_dev_`. Limits: 120 req/min, 5K req/day.

### B) x402 pay-per-call (no signup, analytics only)

Pays $0.01 USDC per request via the [x402 protocol](https://www.x402.org/). EVM (Base) or Solana.

```bash
export WALLET_PRIVATE_KEY="0x..."     # EVM (Base) — 0x-prefixed hex
export WALLET_PRIVATE_KEY="5C1y..."   # Solana — base58 keypair
zerion portfolio <address> --x402

# Or enable globally
export ZERION_X402=true
```

Both chains at once:
```bash
export EVM_PRIVATE_KEY="0x..."
export SOLANA_PRIVATE_KEY="5C1y..."
export ZERION_X402_PREFER_SOLANA=true   # optional
```

### C) MPP pay-per-call (analytics only, EVM Tempo)

Pays $0.01 USDC per request via [MPP](https://mpp.dev) on [Tempo](https://tempo.xyz).

```bash
export TEMPO_PRIVATE_KEY="0x..."      # or reuse WALLET_PRIVATE_KEY
zerion portfolio <address> --mpp

# Or enable globally
export ZERION_MPP=true
```

> Trading commands (`swap`, `bridge`, `send`) always use the API key + an agent token, regardless of `ZERION_X402` / `ZERION_MPP`.

## Which skill for which task

| Intent | Skill |
|--------|-------|
| What's in this wallet? portfolio, positions, history, PnL, watchlist | **`zerion-analyze`** |
| Swap / bridge / send tokens | **`zerion-trading`** |
| Sign a message or EIP-712 typed data (no broadcast) | **`zerion-sign`** |
| Create / import / list / backup / delete wallets | **`zerion-wallet`** |
| Set up agent tokens + policies for autonomous trading | **`zerion-agent-management`** |

## Output contract

All commands emit JSON to stdout (default — agent-friendly). Errors emit structured JSON to stderr:

```json
{ "error": { "code": "missing_api_key", "message": "..." } }
```

Flags: `--json` (default), `--pretty` (auto-enabled for TTY), `--quiet`.

## Supported chains

`ethereum`, `base`, `arbitrum`, `optimism`, `polygon`, `binance-smart-chain`, `avalanche`, `gnosis`, `scroll`, `linea`, `zksync-era`, `zora`, `blast`, `solana`.

Use `zerion chains` for the live catalog with metadata.

## Common error codes

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set env var or use `--x402` for analytics |
| `no_agent_token` | No agent token for trading/signing | See `zerion-agent-management` skill |
| `no_wallet` | No wallet specified, no default | `--wallet <name>` or set `defaultWallet` config |
| `wallet_not_found` | Wallet not in local vault | `zerion wallet list` to check |
| `unsupported_chain` | Invalid `--chain` value | `zerion chains` for valid IDs |
| `api_error` 401 | Invalid API key | Check key at dashboard.zerion.io |
| `api_error` 429 | Rate limited | Wait, lower frequency, or switch to x402 |

## Key management

Wallets are encrypted with AES-256-GCM via the Open Wallet Standard (OWS) vault at `~/.ows/`. Private keys never leave the device; signing happens locally. The Zerion API never sees keys.

`~/.zerion/config.json` (mode 0o600) stores agent tokens, default wallet, default chain, and slippage.

## Resources

- API docs: [developers.zerion.io](https://developers.zerion.io)
- Dashboard: [dashboard.zerion.io](https://dashboard.zerion.io)
- x402 protocol: [x402.org](https://www.x402.org/)
- CLI source: [github.com/zeriontech/zerion-cli](https://github.com/zeriontech/zerion-cli)
