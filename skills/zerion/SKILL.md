---
name: zerion
description: "Crypto wallet API + CLI for AI agents. Single entry point for wallet analysis (portfolio, positions, history, PnL), on-chain trading (swap, bridge, send), off-chain signing (EIP-191, EIP-712), wallet management (create/import/backup), agent tokens + policies for autonomous trading, and partner integrations (0x, Bankr, Li.Fi, Moonpay, Uniswap, Vaults.fyi, Trails, Umbra, Somnia, Monad, Sendai). Use this skill for any crypto wallet, DeFi, or on-chain task. Deep docs load on demand from `capabilities/` and `partners/`."
license: MIT
allowed-tools: Bash, Read
---

# Zerion

Unified API + CLI for crypto wallets across 14 EVM chains and Solana. The `zerion` binary ships from npm; this skill is the entry point for **all** Zerion capabilities. Capability and partner docs live in nested files and are **loaded on demand**.

## Setup

Skills shell out to the `zerion` binary. Don't pre-install — try the command first. If a `zerion` invocation fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. The npm package is `zerion-cli`; the installed binary is `zerion`.

## Authentication

Three modes. Pick one for analytics; trading always uses an API key.

### A) API key (recommended)

```bash
export ZERION_API_KEY="zk_dev_..."
```

Get yours at [dashboard.zerion.io](https://dashboard.zerion.io). Dev keys begin with `zk_dev_`. Limits: 120 req/min, 5K req/day.

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

## Capabilities — load on demand

Before executing any capability below, **Read the matching file** for the full command surface, flags, edge cases, and examples.

| Task | Read |
|------|------|
| Wallet analysis: portfolio, positions, history, PnL, watchlist | `capabilities/analyze.md` |
| On-chain trading: swap, bridge, send | `capabilities/trading.md` |
| Off-chain signing: EIP-191 messages, EIP-712 typed data | `capabilities/sign.md` |
| Wallet management: create, import, list, fund, backup, export-key, delete | `capabilities/wallet.md` |
| Agent tokens + security policies for autonomous trading | `capabilities/agent-management.md` |
| 0x Swap API v2 (direct integration, Permit2/AllowanceHolder, gasless) | `capabilities/swap-0x.md` |

**Pairing rules:**
- Trading + signing require an agent token → see `capabilities/agent-management.md` first if user has none.
- Run analysis before trading to verify balances and positions.

## Partner integrations — opt-in

These cover specialized flows on top of the core CLI. User must **name the partner** (or describe a flow that maps to one). Then Read `partners/<name>.md`.

| Partner | What it does | Read |
|---------|--------------|------|
| Bankr | Twitter/X-native trading bot patterns | `partners/bankr.md` |
| Li.Fi Earn | Cross-chain yield routing | `partners/lifi-earn.md` |
| Monad addresses | Monad chain address tooling | `partners/monad-addresses.md` |
| Moonpay (onramp) | Fiat → crypto onramp | `partners/moonpay-onramp.md` |
| Moonpay (Iron) | Iron stablecoin flows | `partners/moonpay-iron.md` |
| Moonpay (Predict) | Prediction market integration | `partners/moonpay-predict.md` |
| Sendai ideas | Crypto idea discovery + validation, competitor mapping, DeFi TVL research | `partners/sendai-ideas.md` |
| Somnia (blockchain) | Somnia L1 ops | `partners/somnia-blockchain.md` |
| Somnia (reactivity) | Somnia reactive smart contracts | `partners/somnia-reactivity.md` |
| Trails (cross-chain swap) | Cross-chain swap routing | `partners/trails-crosschainswap.md` |
| Trails (deposit) | Cross-chain deposit flows | `partners/trails-deposit.md` |
| Umbra | Private (stealth-address) transfers | `partners/umbra-privatetxn.md` |
| Uniswap LP | Liquidity position management | `partners/uniswap-lp.md` |
| Uniswap x402 | Swap with x402 pay-per-call | `partners/uniswap-x402.md` |
| Vaults.fyi (deposit) | Vault deposits | `partners/vaultsfyi-deposit.md` |
| Vaults.fyi (market intel) | Yield market intelligence | `partners/vaultsfyi-market-intel.md` |
| Vaults.fyi (rebalance) | Auto-rebalance positions | `partners/vaultsfyi-rebalance.md` |
| Vaults.fyi (risk monitor) | Risk dashboards | `partners/vaultsfyi-risk-monitor.md` |
| Vaults.fyi (strategist) | Multi-strategy yield agent | `partners/vaultsfyi-strategist.md` |
| Vaults.fyi (watchlist) | Vault watchlists | `partners/vaultsfyi-watchlist.md` |
| Vaults.fyi (yield optimizer) | Yield optimization | `partners/vaultsfyi-yield-optimizer.md` |
| Consolidate | Sweep all tokens on a chain into one target | `partners/consolidate.md` |

**Rule:** never preload partner docs. Only Read when the user explicitly invokes the partner or asks for a flow that uniquely maps to it.

For authoring new partner integrations, Read `partner-skill-creator.md`.

## Output contract

All commands emit JSON to stdout (default — agent-friendly). Errors emit structured JSON to stderr:

```json
{ "error": { "code": "missing_api_key", "message": "..." } }
```

Flags: `--json` (default), `--pretty` (auto-enabled for TTY), `--quiet`.

## Supported chains

`ethereum`, `base`, `arbitrum`, `optimism`, `polygon`, `binance-smart-chain`, `avalanche`, `gnosis`, `scroll`, `linea`, `zksync-era`, `zora`, `blast`, `solana`.

Solana supports same-chain swaps and bidirectional bridging to/from EVM chains. Cross-format bridges (Solana ↔ EVM) require an explicit destination via `--to-wallet <name>` or `--to-address <addr>` matching the target chain's format.

Command shapes:
- Same-chain swap: `zerion swap <chain> <amount> <from-token> <to-token>`
- Cross-chain bridge: `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>`

See `capabilities/trading.md` for the full flag reference.

Use `zerion chains` for the live catalog with metadata.

## Common error codes

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` set | Set env var or use `--x402` for analytics |
| `no_agent_token` | No agent token for trading/signing | See `capabilities/agent-management.md` |
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
- CLI source: [github.com/zeriontech/zerion-ai](https://github.com/zeriontech/zerion-ai)
