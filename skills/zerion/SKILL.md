---
name: zerion
description: "Crypto wallet API + CLI for AI agents. Single entry point for wallet analysis (portfolio, positions, history, PnL), on-chain trading (swap, bridge, send), off-chain signing (EIP-191, EIP-712), wallet management (create/import/backup), agent tokens + policies for autonomous trading, and partner integrations (0x, Bankr, Li.Fi, Moonpay, Uniswap, Vaults.fyi, Trails, Umbra, Somnia, Monad, Sendai, Yellow). Use this skill for any crypto wallet, DeFi, or on-chain task. Deep docs load on demand from `capabilities/` and `partners/`."
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
| Human review in the browser: read-only wallets, review thresholds, `--review` | `capabilities/trading.md` § "Signing routes & web-app handoff" |
| Bundle several actions into one signing session / one review (`--prepare` + `bundle`) | `capabilities/bundle.md` |
| Off-chain signing: EIP-191 messages, EIP-712 typed data | `capabilities/sign.md` |
| Wallet management: create, import, add read-only, list, fund, review threshold, backup, export-key, delete | `capabilities/wallet.md` |
| Agent tokens + security policies for autonomous trading | `capabilities/agent-management.md` |
| 0x Swap API v2 (direct integration, Permit2/AllowanceHolder, gasless) | `capabilities/swap-0x.md` |

**Pairing rules:**
- Trading + signing require an agent token → see `capabilities/agent-management.md` first if user has none.
- Run analysis before trading to verify balances and positions.

## Signing routes — trades don't always sign locally

Every trade and message signature takes one of two routes, decided automatically **before** anything
is signed:

- **Local signing (default)** — the CLI signs with the agent token as passphrase and broadcasts. One shot, unattended.
- **Web-app handoff** — the CLI encodes the transaction into an `app.zerion.io` link, **opens a
  browser**, and **blocks** waiting for a human to sign there (default wait 300 s). The URL is also
  printed to stderr, so a headless agent can hand it to the user instead of relying on the browser opening.

The handoff fires when any of these hit — **know this before you run a trade**, because it changes
whether the command can complete unattended:

| Trigger | Set by |
|---|---|
| Read-only wallet (no key material) | `zerion wallet add <address\|ens> --name <name>` |
| Sell-side USD value over the wallet's review threshold — **trades only** | `zerion wallet set-review-threshold <wallet> <usd\|off>` |
| Explicit force | `--review` on the command |

Messages have no USD value, so `sign-message` / `sign-typed-data` ignore the threshold — only the
read-only and `--review` triggers apply there (`capabilities/sign.md`).

The CLI prints `Signing route: <route> — <reason>` to stderr on every trade, and the JSON output
carries `signedVia: "local" | "web-app"`, so you can always tell which route was taken. A handoff
ends `completed` / `rejected` / `failed` / `timeout` (or `aborted` on Ctrl-C), reported as `status`
in that same JSON: only `completed` exits 0, every other outcome exits non-zero with a structured
stderr error — plan unattended runs around that.

`consolidate --execute` is the exception: it **always signs locally** and never consults the route, because
a sweep is N independent transactions and the threshold is a per-transaction ceiling. It therefore needs
key material — on a read-only wallet every row fails. Route a whole sweep through review with
`zerion bundle --group "$(zerion consolidate <chain> <token> --prepare)"` instead.

Full details in `capabilities/trading.md`; read-only wallets and thresholds in `capabilities/wallet.md`.

## Partner integrations — opt-in

These cover specialized flows on top of the core CLI. User must **name the partner** (or describe a flow that maps to one). Then Read `partners/<name>.md`.

| Partner | What it does | Read |
|---------|--------------|------|
| Bankr | Twitter/X-native trading bot patterns | `partners/bankr.md` |
| Li.Fi Earn | Cross-chain yield routing | `partners/lifi-earn.md` |
| Monad addresses | Monad chain address tooling | `partners/monad-addresses.md` |
| Staking | Liquid staking and restaking (Lido, Rocket Pool, Frax, cbETH, EigenLayer) | `partners/staking.md` |
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
| Yellow | Multiparty off-chain settlement rooms | `partners/yellow-settlement-room.md` |
| Consolidate | Sweep all tokens on a chain into one target | `partners/consolidate.md` |
| Treasury liquidation | Drain a wallet across all chains, and/or sweep a whole multi-chain portfolio into one token | `partners/treasury-liquidation.md` |

**Rule:** never preload partner docs. Only Read when the user explicitly invokes the partner or asks for a flow that uniquely maps to it.

For authoring new partner integrations, Read `partner-skill-creator.md`.

## Output contract

All commands emit JSON to stdout (default — agent-friendly). Errors emit structured JSON to stderr:

```json
{ "error": { "code": "missing_api_key", "message": "..." } }
```

Flags: `--json` (default), `--pretty` (auto-enabled for TTY), `--quiet`.

## Supported chains

Zerion supports **60+ chains**, and adds more over time. Per-chain capabilities differ — some support swap **and** bridge **and** send, others only sending or reads — so `zerion chains` (or `zerion chains --json` for the `supportsTrading` / `supportsBridge` / `supportsSending` flags) is the **source of truth**.

> ⚠️ **Never tell a user a chain is unsupported based on the static list below.** It is a snapshot and goes stale as chains are added. If a chain you need isn't listed here — or you're unsure whether it supports a given action — run `zerion chains` and check the flags **instead of stopping**. (This exact list, at 14 chains, once caused an agent to wrongly report that `robinhood`, `monad`, `hyperevm`, and ~20 other live chains "cannot be moved by Zerion.")

Snapshot of the live catalog (verify with `zerion chains`): `0g`, `abstract`, `ape`, `arbitrum`, `astar-zkevm`, `aurora`, `avalanche`, `base`, `berachain`, `binance-smart-chain`, `blast`, `bob`, `celo`, `cronos-zkevm`, `cyber`, `degen`, `ethereum`, `fantom`, `fraxtal`, `gravity-alpha`, `hyperevm`, `ink`, `katana`, `lens`, `linea`, `lisk`, `manta-pacific`, `mantle`, `megaeth`, `metis-andromeda`, `mode`, `monad`, `okbchain`, `opbnb`, `optimism`, `plasma`, `polygon`, `polygon-zkevm`, `polynomial`, `rari`, `re-al`, `redstone`, `robinhood`, `ronin`, `scroll`, `sei`, `solana`, `somnia`, `soneium`, `sonic`, `swellchain`, `taiko`, `tempo`, `tomochain`, `tron`, `unichain`, `wonder`, `world`, `xdai`, `xinfin-xdc`, `zero`, `zkcandy`, `zklink-nova`, `zksync-era`, `zora`.

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
| `readonly_chain_mismatch` | Read-only wallet's address format doesn't match an explicitly requested chain | An EVM (`0x…`) read-only wallet can't sign on Solana, and vice versa. Read commands need no `--chain` |
| `api_error` 401 | Invalid API key | Check key at dashboard.zerion.io |
| `api_error` 429 | Rate limited | Wait, lower frequency, or switch to x402 |

## Key management

Keystore wallets are encrypted with AES-256-GCM via the Open Wallet Standard (OWS) vault at `~/.ows/`. Private keys never leave the device; on the local route signing happens here. The Zerion API never sees keys.

**Read-only wallets** hold no key material at all — just a name + address in `~/.zerion/readonly-wallets.json` — so they sign only via the web-app handoff above.

`~/.zerion/config.json` (mode 0o600) stores agent tokens, review thresholds, default wallet, default chain, and slippage.

## Resources

- API docs: [developers.zerion.io](https://developers.zerion.io)
- Dashboard: [dashboard.zerion.io](https://dashboard.zerion.io)
- x402 protocol: [x402.org](https://www.x402.org/)
- CLI source: [github.com/zeriontech/zerion-ai](https://github.com/zeriontech/zerion-ai)
