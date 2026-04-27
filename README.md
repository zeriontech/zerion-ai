# Zerion CLI

CLI for [Zerion Wallet](https://zerion.io). Analyze wallets, sign, swap, and bridge on-chain with agent-managed wallets across EVM chains and Solana, all from the command line.

> [!NOTE]
> **Alpha Preview** — This CLI is under active development. Commands, flags, and output formats may change or be removed without notice between releases. Do not depend on current behavior in production workflows.

## Installation

```bash
npm install -g zerion-cli
```

Or set up everything in one command (install CLI globally, configure your API key, and add skills across all detected coding agents):

```bash
npx -y zerion-cli init -y --browser
```

- `-y` runs setup non-interactively
- `--browser` opens [dashboard.zerion.io](https://dashboard.zerion.io) so you can grab an API key and paste it back
- skills install globally to every detected AI coding agent by default

Requires Node.js 20 or later.

### Setup Skills and MCP

If you are using an AI coding agent (Claude Code, Cursor, Windsurf, Claude Desktop, etc.), you can also install the skills individually with:

```bash
zerion setup skills
```

This installs skills globally across all detected coding agents by default. Use `--agent <name>` to scope it to one agent, or `-g` to force a global install.

To install the Zerion hosted MCP server (live Zerion API docs as a tool inside your editor):

```bash
zerion setup mcp --agent <claude-code|cursor|claude-desktop>
```

### Agent skills

The `init` command installs the Zerion agent skill bundle into AI coding agents (Cursor, Claude Code, Windsurf, etc.). Six skills ship in the bundle:

- **`zerion`** — entry point with install, authentication, and routing to the right capability skill
- **`zerion-wallet`** — local encrypted wallets: create, import (key or mnemonic), list, fund, backup, delete, sync to the Zerion app
- **`zerion-agent-management`** — mint and scope agent tokens + policies (chain locks, allowlists, transfer/approval gates, expiry) for autonomous trading and signing
- **`zerion-analyze`** — read-only wallet insights: portfolio, positions, history, PnL, watchlist; supports x402 / MPP pay-per-call
- **`zerion-sign`** — off-chain signatures (EIP-191, EIP-712, Solana raw) without broadcasting a transaction; requires an agent token
- **`zerion-trading`** — swap, bridge, and send across 14 EVM chains and Solana; uses an API key + agent token

To reinstall skills manually:

```bash
zerion setup skills
```

Skills live in [`zeriontech/zerion-agent`](https://github.com/zeriontech/zerion-agent).

## Manual setup, agent execution

Zerion CLI splits into two surfaces, by design.

- **Wallet management and agent token setup are manual.** `wallet create`, `import`, `backup`, and `delete` all prompt for a passphrase. `wallet sync` emits a QR code you scan with the Zerion app. `agent create-token` mints a scoped trading credential bound to a specific wallet, and `agent create-policy` attaches the rules it has to obey — allowed chains, expiry, transfer/approval gates, contract allowlists. The sibling admin commands (`agent list-tokens`, `use-token`, `revoke-token`, `list-policies`, `show-policy`, `delete-policy`) are also gestures you make yourself. No key material moves and no spending credential widens without you in the loop.
- **Analysis, signing, trading, and discovery are for agents.** `analyze`, `portfolio`, `positions`, `history`, `pnl`, `sign-message`, `sign-typed-data`, `swap`, `bridge`, `send`, `swap tokens`, `search`, `chains`, `wallet list`, `wallet fund`, and `watch list` emit JSON to stdout, structured errors to stderr, and skip confirmation dialogs. Once an agent token is configured, signing and trading fire immediately — the token authorizes operations on behalf of the wallet without a passphrase prompt.

Setup gestures (`init`, `setup skills`, `setup mcp`, `config set/unset/list`, `watch` add/remove) are one-time configuration steps you run yourself before automation takes over.

The split is the point. You stage by hand once — create or import a wallet, set a passphrase, mint an agent token, attach a policy — then hand the agent token to an automation that can only do what the policy allows. Treat agent tokens like API keys with spending power; use [agent policies](#agent-policies) to scope them down to specific chains, addresses, or expiry windows.

## Authentication

Three options. The CLI auto-detects which is active.

### A) API key (recommended)

Get a key at **[dashboard.zerion.io](https://dashboard.zerion.io)** — it's free and takes a minute. Keys begin with `zk_`.

```bash
export ZERION_API_KEY="zk_..."
```

- HTTP Basic Auth
- Required for analysis and trading commands (analysis can also use x402 / MPP pay-per-call instead — see options B and C)

You can also persist it via config:

```bash
zerion config set apiKey zk_...
```

### B) x402 pay-per-call

**No API key needed.** Pay $0.01 USDC per request via the [x402 protocol](https://www.x402.org/). Supports EVM (Base) and Solana.

> Pay-per-call applies to analytics commands only (`portfolio`, `positions`, `history`, `pnl`, `analyze`). Trading commands always use an API key.

```bash
export WALLET_PRIVATE_KEY="0x..."     # EVM (Base) — 0x-prefixed hex
export WALLET_PRIVATE_KEY="5C1y..."   # Solana — base58 encoded keypair

zerion analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
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

## Commands

Every command supports `--help` for full flag documentation. Run `zerion --help` for the top-level command list.

### Wallet Analysis

Read-only. Supports `--x402` and `--mpp` for pay-per-call.

| Command | Description |
|---------|-------------|
| `zerion analyze <address\|ens>` | Full analysis — portfolio, positions, transactions, PnL in parallel |
| `zerion portfolio <address\|ens>` | Portfolio value and top positions |
| `zerion positions <address\|ens>` | Token + DeFi positions (`--positions all\|simple\|defi`) |
| `zerion history <address\|ens>` | Transaction history (`--limit`, `--chain`) |
| `zerion pnl <address\|ens>` | Profit & loss (realized, unrealized, fees) |
| `zerion search <query>` | Search tokens by name or symbol |
| `zerion chains` | List supported chains |

### Trading

Requires an API key (or agent token for unattended use).

| Command | Description |
|---------|-------------|
| `zerion swap <from> <to> <amount>` | Swap tokens on a single chain |
| `zerion swap <from> <to> <amount> --to-chain <chain>` | Cross-chain swap |
| `zerion swap tokens [chain]` | List tokens available for swap |
| `zerion bridge <token> <chain> <amount>` | Bridge tokens cross-chain |
| `zerion bridge <token> <chain> <amount> --to-token <tok>` | Bridge + swap on destination |
| `zerion send <token> <amount> --to <address> --chain <chain>` | Send tokens |

### Wallet Management

Encrypted local wallets. EVM + Solana supported. Passphrase required for all destructive ops.

| Command | Description |
|---------|-------------|
| `zerion wallet create --name <name>` | Create encrypted wallet (EVM + Solana) |
| `zerion wallet import --name <name> --evm-key` | Import from EVM private key (interactive) |
| `zerion wallet import --name <name> --sol-key` | Import from Solana private key (interactive) |
| `zerion wallet import --name <name> --mnemonic` | Import from seed phrase (all chains) |
| `zerion wallet list` | List all wallets |
| `zerion wallet fund` | Show deposit addresses for funding |
| `zerion wallet backup --wallet <name>` | Export recovery phrase |
| `zerion wallet delete <name>` | Permanently delete a wallet (requires passphrase) |
| `zerion wallet sync --wallet <name>` | Sync wallet to Zerion app via QR code |
| `zerion wallet sync --all` | Sync all wallets to Zerion app |

### Signing

| Command | Description |
|---------|-------------|
| `zerion sign-message <message> --chain <chain>` | Sign EIP-191 (EVM) or raw (Solana) message |
| `zerion sign-message <message> --encoding hex` | Treat message as hex bytes |
| `zerion sign-typed-data --data '<json>'` | Sign EIP-712 typed data (EVM only) |
| `zerion sign-typed-data --file <path>` | Read EIP-712 typed data from file |
| `cat typed.json \| zerion sign-typed-data` | Read EIP-712 typed data from stdin |

### Agent Tokens

Scoped API tokens for unattended trading. Token auto-saves to config; required for `swap`, `bridge`, `send`.

| Command | Description |
|---------|-------------|
| `zerion agent create-token --name <bot> --wallet <wallet>` | Create scoped token |
| `zerion agent list-tokens` | List active agent tokens |
| `zerion agent use-token --wallet <wallet>` | Switch active token by wallet |
| `zerion agent revoke-token --name <bot>` | Revoke a token |

### Agent Policies

Restrict what an agent token can do — chains, expiry, transfers, approvals, allowlists.

| Command | Description |
|---------|-------------|
| `zerion agent create-policy --name <policy>` | Create security policy (flags below) |
| `zerion agent list-policies` | List all policies |
| `zerion agent show-policy <id>` | Show policy details |
| `zerion agent delete-policy <id>` | Delete a policy |

Policy flags:

| Flag | Description |
|------|-------------|
| `--chains <list>` | Restrict to specific chains (comma-separated) |
| `--expires <duration>` | Token expiry (e.g. `24h`, `7d`) |
| `--deny-transfers` | Block raw ETH/native transfers |
| `--deny-approvals` | Block ERC-20 approval calls |
| `--allowlist <addresses>` | Only allow listed contract/wallet addresses |

### Watchlist

Track wallets by name without exposing addresses in commands.

| Command | Description |
|---------|-------------|
| `zerion watch <address> --name <label>` | Add wallet to watchlist |
| `zerion watch list` | List watched wallets |
| `zerion watch remove <name>` | Remove from watchlist |
| `zerion analyze <name>` | Analyze a watched wallet by name |

### Setup

| Command | Description |
|---------|-------------|
| `zerion init` | One-shot onboarding — install CLI globally, configure API key, install agent skills |
| `zerion init -y --browser` | Non-interactive init that opens dashboard.zerion.io for the API key |
| `zerion setup skills` | Install Zerion agent skills into detected coding agents |
| `zerion setup skills --agent claude-code` | Install into a specific agent |
| `zerion setup mcp --agent <name>` | Merge the Zerion hosted-MCP fragment into an agent's config |
| `zerion setup mcp --print` | Print the canonical MCP fragment without writing |

### Configuration

| Command | Description |
|---------|-------------|
| `zerion config set <key> <value>` | Set config (`apiKey`, `defaultWallet`, `defaultChain`, `slippage`) |
| `zerion config unset <key>` | Remove a config value (resets to default) |
| `zerion config list` | Show current configuration |

## Global Flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Specify wallet (default: from config) |
| `--address <addr\|ens>` | Use raw address or ENS name |
| `--watch <name>` | Use watched wallet by name |
| `--chain <chain>` | Specify chain (default: `ethereum`) |
| `--to-chain <chain>` | Destination chain for cross-chain swaps |
| `--positions all\|simple\|defi` | Filter positions type |
| `--limit <n>` | Limit results (default: 20 for list ops) |
| `--offset <n>` | Skip first N results (pagination) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--x402` | Pay-per-call on Base or Solana (analytics only) |
| `--mpp` | Pay-per-call on Tempo (analytics only) |
| `--json` | JSON output (default) |
| `--pretty` | Human-readable output |
| `--quiet` | Minimal output |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZERION_API_KEY` | API key (get at [dashboard.zerion.io](https://dashboard.zerion.io)) |
| `WALLET_PRIVATE_KEY` | Pay-per-call key. `0x...` → x402 on Base; `base58` → x402 on Solana; `0x...` also works for MPP |
| `EVM_PRIVATE_KEY` | EVM key for x402 on Base (overrides `WALLET_PRIVATE_KEY` for EVM) |
| `SOLANA_PRIVATE_KEY` | Solana key for x402 on Solana (overrides `WALLET_PRIVATE_KEY` for Solana) |
| `TEMPO_PRIVATE_KEY` | EVM key for MPP on Tempo (overrides `WALLET_PRIVATE_KEY` for MPP) |
| `ZERION_X402` | `true` enables x402 globally (analytics only) |
| `ZERION_X402_PREFER_SOLANA` | `true` prefers Solana over Base when both keys set |
| `ZERION_MPP` | `true` enables MPP globally (analytics only) |
| `SOLANA_RPC_URL` | Custom Solana RPC endpoint |
| `ETH_RPC_URL` | Custom Ethereum RPC endpoint (used for ENS resolution) |

## Output

All commands emit JSON to stdout (default) for agent compatibility. Errors emit JSON to stderr with a `code` field for programmatic handling. Use `--pretty` for human-readable output, `--quiet` for minimal.

## Failure Modes

The CLI handles:

- missing or invalid API key
- invalid wallet address or ENS resolution failure
- unsupported chain filter
- empty wallets / no positions
- rate limits (HTTP 429)
- upstream timeout or temporary unavailability

All errors are emitted as structured JSON on stderr with a `code` field.

## Development

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
2. release-please opens/updates a release PR (`chore(main): release X.Y.Z`) with version bump and CHANGELOG
3. Merge the release PR when ready to ship
4. GitHub Release is created automatically → triggers `npm publish`

To force a specific version, add `Release-As: 2.0.0` in a commit message body.

**CI setup:**

- `NPM_TOKEN` repo secret is required for npm publish (use a granular access token)
- `.release-please-manifest.json` tracks the current version
- `.github/workflows/release-please.yml` handles release PR creation and npm publish
- `.github/workflows/test.yml` runs tests on PRs and pushes to main

## Resources

- **API documentation** — <https://developers.zerion.io/introduction>
- **Get an API key** — <https://dashboard.zerion.io>
- **Agent skills + MCP** — <https://github.com/zeriontech/zerion-agent>
- **Building with AI** — <https://developers.zerion.io/reference/building-with-ai>

## License

MIT — see [LICENSE](./LICENSE).
