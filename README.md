# zerion-cli

**Maintained by Zerion.**

`zerion` is the unified, JSON-first CLI for using [Zerion](https://zerion.io) from AI agents, developer tools, and command-based runtimes. It covers wallet analysis (portfolio, positions, transactions, PnL) and autonomous trading (swap, bridge, send) across 14 chains, plus wallet/agent-token/policy management.

> **Looking for skills, plugins, or MCP setup?** See the agent-side companion repo: [`zeriontech/zerion-agent`](https://github.com/zeriontech/zerion-agent). The same `zerion` CLI on this page powers those skills under the hood.

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

Three options. CLI auto-detects which is active.

### Option A: API key

```bash
export ZERION_API_KEY="zk_dev_..."
```

- HTTP Basic Auth, dev keys begin with `zk_dev_`
- Current dev-key limits: **120 requests/minute**, **5k requests/day**
- Get one: [dashboard.zerion.io](https://dashboard.zerion.io)

### Option B: x402 pay-per-call

**No API key needed.** Pay $0.01 USDC per request via the [x402 protocol](https://www.x402.org/). Supports EVM (Base) and Solana.

> Pay-per-call applies to analytics commands only (`portfolio`, `positions`, `history`, `pnl`, `analyze`). Trading commands always use an API key.

```bash
export WALLET_PRIVATE_KEY="0x..."     # EVM (Base) — 0x-prefixed hex
export WALLET_PRIVATE_KEY="5C1y..."   # Solana — base58 encoded keypair

zerion wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
# or
export ZERION_X402=true
```

Both chains simultaneously:

```bash
export EVM_PRIVATE_KEY="0x..."
export SOLANA_PRIVATE_KEY="5C1y..."
export ZERION_X402_PREFER_SOLANA=true   # optional, prefers Solana when both set
```

### Option C: MPP pay-per-call

**No API key needed.** Pay $0.01 USDC per request via the [MPP protocol](https://mpp.dev) on [Tempo](https://tempo.xyz). EVM only.

```bash
export WALLET_PRIVATE_KEY="0x..."   # EVM private key with USDC on Tempo
# or
export TEMPO_PRIVATE_KEY="0x..."

zerion portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --mpp
# or
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

For the full subcommand reference, see [`COMMANDS.md`](./COMMANDS.md).

## Skills, plugin, MCP

If you're using an AI coding agent (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, etc.), don't write CLI prompts by hand — install [`zerion-agent`](https://github.com/zeriontech/zerion-agent) and the agent will know how to use these commands automatically.

Three install paths:

```bash
# Any agentskills.io host (45+)
npx skills add zeriontech/zerion-agent

# Claude Code marketplace
/plugin marketplace add zeriontech/zerion-agent
/plugin install zerion-agent@zerion
```

`zerion-agent` also ships the hosted MCP config (`developers.zerion.io/mcp`) for MCP-native runtimes.

## Example wallets

This repo's docs and tests use the same public wallets:

- `vitalik.eth` / `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
- ENS DAO treasury / `0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e`
- Aave collector / `0x25F2226B597E8F9514B3F68F00F494CF4F286491`

## What ships in this repo

- `zerion.js`, `router.js`, `commands/`, `lib/`, `policies/` — the `zerion` CLI source, published to npm as `zerion-cli` with binary `zerion`. Full subcommand reference in [`COMMANDS.md`](./COMMANDS.md).
- [`tests/`](./tests/) — unit + integration tests
- [`docs/`](./docs/) — design docs, x402 endpoints reference, internal specs

## Failure modes

The CLI handles:

- missing or invalid API key
- invalid wallet address or ENS resolution failure
- unsupported chain filter
- empty wallets / no positions
- rate limits (HTTP 429)
- upstream timeout or temporary unavailability

## License

MIT — see [LICENSE](./LICENSE).
