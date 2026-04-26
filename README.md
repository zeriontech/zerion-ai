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

## Contributing

Maintained by the Zerion team.

### Scope

This repo is intentionally narrow:

- the `zerion` JSON-first CLI for AI agents and OpenClaw-like environments
- 110+ unit and integration tests covering CLI behavior

For agent skills, plugin manifests, and MCP setup, see the companion repo: [`zeriontech/zerion-agent`](https://github.com/zeriontech/zerion-agent).

Please prefer small, concrete improvements over broad abstractions.

### Development

```bash
npm install
npm test
node ./zerion.js --help
```

### Contribution guidelines

- Keep examples copy-pasteable.
- Prefer official Zerion naming and documented behavior.
- Document real gaps instead of inventing interfaces.
- Preserve JSON-first CLI output for agent compatibility.

### Releasing to npm

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing.

**Commit conventions** — use [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

- `feat:` — new feature → minor version bump
- `fix:` — bug fix → patch version bump
- `feat!:` or `fix!:` — breaking change → major version bump
- `docs:`, `chore:`, `test:` — no release triggered

**Release flow:**

1. Merge `feat:` or `fix:` commits to `main`
2. release-please automatically opens/updates a release PR (`chore(main): release X.Y.Z`) with version bump and CHANGELOG
3. Merge the release PR when ready to ship
4. GitHub Release is created automatically → triggers `npm publish`

To force a specific version, add `Release-As: 2.0.0` in a commit message body.

**CI setup:**

- `NPM_TOKEN` repo secret is required for npm publish (use a granular access token)
- `.release-please-manifest.json` tracks the current version
- `.github/workflows/release-please.yml` handles both release PR creation and npm publish
- `.github/workflows/test.yml` runs tests on PRs and pushes to main

### Issues and questions

For Zerion API questions, start with the public docs:

- <https://developers.zerion.io/reference/getting-started>
- <https://developers.zerion.io/reference/building-with-ai>

## License

MIT — see [LICENSE](./LICENSE).
