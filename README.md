# Zerion CLI

CLI for [Zerion Wallet](https://zerion.io). Analyze wallets, sign, swap, and bridge on-chain with agent-managed wallets across EVM chains and Solana, all from the command line. Wallet management is built on the [Open Wallet Standard](https://github.com/open-wallet-standard/core).

> [!NOTE]
> **Alpha Preview** — This CLI is under active development. Commands, flags, and output formats may change or be removed without notice between releases. Do not depend on current behavior in production workflows.

## Installation

```bash
npm install -g zerion-cli
```

Or set up everything in one command (install CLI globally, authenticate via browser, and add skills across all detected coding agents):

```bash
npx -y zerion-cli init
```

- opens your browser to [dashboard.zerion.io](https://dashboard.zerion.io), waits for you to click **Authorize**, then saves the API key automatically (PKCE flow — no manual paste)
- skills install globally to every detected AI coding agent by default
- pass `-y` to run non-interactively in CI; auth is skipped and you can finish later with `zerion login`

Requires Node.js 20 or later.

## Agent skills

Six skills ship in this repo (under [`./skills/`](./skills/)):

| Skill | What it does |
|-------|--------------|
| [`zerion`](./skills/zerion/SKILL.md) | Umbrella: install, authentication, routing to specific skills, chains reference |
| [`zerion-analyze`](./skills/zerion-analyze/SKILL.md) | Portfolio, positions, history, PnL, analyze, token search, watchlist (read-only; supports x402 / MPP) |
| [`zerion-trading`](./skills/zerion-trading/SKILL.md) | Swap, bridge, send tokens (on-chain actions; needs API key + agent token) |
| [`zerion-sign`](./skills/zerion-sign/SKILL.md) | Off-chain signing — sign-message (EIP-191 / raw), sign-typed-data (EIP-712) |
| [`zerion-wallet`](./skills/zerion-wallet/SKILL.md) | Wallet management — create, import, list, fund, backup, delete, sync |
| [`zerion-agent-management`](./skills/zerion-agent-management/SKILL.md) | Agent tokens + policies (the autonomous-trading primitives) |

Skills follow the [agentskills.io](https://agentskills.io) open standard — a single `skills/` tree powers every supported host.

### Install via zerion CLI (recommended)

```bash
zerion setup skills
```

Installs globally across all detected coding agents. Use `--agent <name>` to scope to one agent, or `-g` to force a global install.

### Install via Claude Code

```text
/plugin marketplace add zeriontech/zerion-ai
/plugin install zerion-agent@zerion
```

### Install via OpenAI Codex CLI

```sh
codex plugin marketplace add zeriontech/zerion-ai
```

Then run `/plugins` in Codex, choose the `zerion` marketplace, and install `zerion-agent`.

### Install via Gemini CLI

```bash
gemini extensions install https://github.com/zeriontech/zerion-ai
```

### Install via agentskills.io (works with 20+ popular agents)

```bash
npx skills add zeriontech/zerion-ai
```

Auto-detects installed agents. Flags: `-g` (user-wide), `-a <agent>` (target one host), `-y` (non-interactive). Full ecosystem: <https://agentskills.io/clients>.

## How to use

After install, ask the agent in natural language.

### Wallet analysis

> Analyze the wallet `vitalik.eth`. Summarize total portfolio value, top 5 holdings, and recent transactions.

> What's the PnL on `0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e` over the last 30 days?

> Show DeFi positions (lending, staking, LP) for my default wallet.

### Trading

> Swap 100 USDC to ETH on Base.

> Bridge 50 USDC from Arbitrum to Optimism.

> Send 0.1 ETH on Base to `vitalik.eth`.

### Wallet management

> Create a new encrypted wallet called `bot-1`.

> Set up an agent token for `bot-1` that's allowed to swap on Base only, with a 7-day expiry.

> List my wallets and which agent tokens are active.

### Signing

> Sign the EIP-712 message in `typed.json` using my `bot-1` wallet.

The agent reaches for the right skill (e.g. `zerion-analyze` for "what's in this wallet", `zerion-trading` for swap/bridge/send) and invokes the underlying `zerion` CLI commands. Skills load only when relevant — agentskills.io's progressive disclosure keeps your context window clean. Multiple skills compose at runtime: a "create wallet, set up agent token, then swap" flow loads `zerion-wallet` → `zerion-agent-management` → `zerion-trading` in sequence.

## Manual setup, agent execution

Zerion CLI splits into two surfaces, by design.

- **Wallet management and agent token setup are manual.** `wallet create`, `import`, `backup`, and `delete` all prompt for a passphrase. `wallet sync` emits a QR code you scan with the Zerion app. `agent create-token` mints a scoped trading credential bound to a specific wallet, and `agent create-policy` attaches the rules it has to obey — allowed chains, expiry, transfer/approval gates, contract allowlists. The sibling admin commands (`agent list-tokens`, `use-token`, `revoke-token`, `list-policies`, `show-policy`, `delete-policy`) are also gestures you make yourself. No key material moves and no spending credential widens without you in the loop.
- **Analysis, signing, trading, and discovery are for agents.** `analyze`, `portfolio`, `positions`, `history`, `pnl`, `sign-message`, `sign-typed-data`, `swap`, `bridge`, `send`, `swap tokens`, `search`, `chains`, `wallet list`, `wallet fund`, and `watch list` emit JSON to stdout, structured errors to stderr, and skip confirmation dialogs. Once an agent token is configured, signing and trading fire immediately — the token authorizes operations on behalf of the wallet without a passphrase prompt.

Setup gestures (`init`, `setup skills`, `config set/unset/list`, `watch` add/remove) are one-time configuration steps you run yourself before automation takes over.

The split is the point. You stage by hand once — create or import a wallet, set a passphrase, mint an agent token, attach a policy — then hand the agent token to an automation that can only do what the policy allows. Treat agent tokens like API keys with spending power; use [agent policies](#agent-policies) to scope them down to specific chains, addresses, or expiry windows.

## Authentication

Three options. The CLI auto-detects which is active.

### A) API key (recommended)

Run the browser-based login flow — it opens [dashboard.zerion.io](https://dashboard.zerion.io), waits for you to click **Authorize**, and saves the key for you (PKCE; no manual paste):

```bash
zerion login              # opens browser, completes via PKCE, saves the key
zerion logout             # clear the saved API key (and any agent tokens)
```

You only do this once — the key persists in `~/.zerion/config.json` (mode 0o600).

For non-interactive setups (CI, scripts, containers) you can supply the key directly:

```bash
zerion login --api-key zk_...    # save a key non-interactively
export ZERION_API_KEY="zk_..."   # or just export it; CLI auto-detects
```

Keys begin with `zk_` (e.g. `zk_dev_…`). Required for analysis and trading commands — analysis can also use x402 / MPP pay-per-call instead (see options B and C).

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

| Command | Description | Example |
|---------|-------------|---------|
| `zerion analyze <address\|ens>` | Full analysis — portfolio, positions, transactions, PnL in parallel | `zerion analyze vitalik.eth` |
| `zerion portfolio <address\|ens>` | Portfolio value and top positions | `zerion portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` |
| `zerion positions <address\|ens>` | Token + DeFi positions (`--positions all\|simple\|defi`) | `zerion positions vitalik.eth --positions defi` |
| `zerion history <address\|ens>` | Transaction history (`--limit`, `--chain`) | `zerion history vitalik.eth --limit 10 --chain ethereum` |
| `zerion pnl <address\|ens>` | Profit & loss (realized, unrealized, fees) | `zerion pnl vitalik.eth` |
| `zerion search <query>` | Search tokens by name or symbol | `zerion search USDC` |
| `zerion chains` | List supported chains | `zerion chains` |

### Trading

Requires an API key (or agent token for unattended use).

| Command | Description | Example |
|---------|-------------|---------|
| `zerion swap <from> <to> <amount>` | Swap tokens on a single chain | `zerion swap usdc eth 100 --chain ethereum` |
| `zerion swap <from> <to> <amount> --to-chain <chain>` | Cross-chain swap | `zerion swap usdc eth 100 --chain base --to-chain ethereum` |
| `zerion swap tokens [chain]` | List tokens available for swap | `zerion swap tokens base` |
| `zerion bridge <token> <chain> <amount>` | Bridge tokens cross-chain | `zerion bridge usdc base 100` |
| `zerion bridge <token> <chain> <amount> --to-token <tok>` | Bridge + swap on destination | `zerion bridge usdc base 100 --to-token eth` |
| `zerion send <token> <amount> --to <address> --chain <chain>` | Send tokens | `zerion send usdc 50 --to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain base` |

### Wallet Management

Encrypted local wallets. EVM + Solana supported. Passphrase required for all destructive ops.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion wallet create --name <name>` | Create encrypted wallet (EVM + Solana) | `zerion wallet create --name trading-bot` |
| `zerion wallet import --name <name> --evm-key` | Import from EVM private key (interactive) | `zerion wallet import --name old-wallet --evm-key` |
| `zerion wallet import --name <name> --sol-key` | Import from Solana private key (interactive) | `zerion wallet import --name sol-bot --sol-key` |
| `zerion wallet import --name <name> --mnemonic` | Import from seed phrase (all chains) | `zerion wallet import --name backup --mnemonic` |
| `zerion wallet list` | List all wallets | `zerion wallet list` |
| `zerion wallet fund` | Show deposit addresses for funding | `zerion wallet fund --wallet trading-bot` |
| `zerion wallet backup --wallet <name>` | Export recovery phrase | `zerion wallet backup --wallet trading-bot` |
| `zerion wallet delete <name>` | Permanently delete a wallet (requires passphrase) | `zerion wallet delete trading-bot` |
| `zerion wallet sync --wallet <name>` | Sync wallet to Zerion app via QR code | `zerion wallet sync --wallet trading-bot` |
| `zerion wallet sync --all` | Sync all wallets to Zerion app | `zerion wallet sync --all` |

### Signing

| Command | Description | Example |
|---------|-------------|---------|
| `zerion sign-message <message> --chain <chain>` | Sign EIP-191 (EVM) or raw (Solana) message | `zerion sign-message "Login to dApp" --chain ethereum` |
| `zerion sign-message <message> --encoding hex` | Treat message as hex bytes | `zerion sign-message 0xdeadbeef --encoding hex --chain ethereum` |
| `zerion sign-typed-data --data '<json>'` | Sign EIP-712 typed data (EVM only) | `zerion sign-typed-data --data "$(cat permit.json)"` |
| `zerion sign-typed-data --file <path>` | Read EIP-712 typed data from file | `zerion sign-typed-data --file permit.json` |
| `cat typed.json \| zerion sign-typed-data` | Read EIP-712 typed data from stdin | `cat permit.json \| zerion sign-typed-data` |

### Agent Tokens

Scoped API tokens for unattended trading. Token auto-saves to config; required for `swap`, `bridge`, `send`.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion agent create-token --name <bot> --wallet <wallet>` | Create scoped token | `zerion agent create-token --name dca-bot --wallet trading-bot` |
| `zerion agent list-tokens` | List active agent tokens | `zerion agent list-tokens` |
| `zerion agent use-token --wallet <wallet>` | Switch active token by wallet | `zerion agent use-token --wallet trading-bot` |
| `zerion agent revoke-token --name <bot>` | Revoke a token | `zerion agent revoke-token --name dca-bot` |

### Agent Policies

Restrict what an agent token can do — chains, expiry, transfers, approvals, allowlists.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion agent create-policy --name <policy>` | Create security policy (flags below) | `zerion agent create-policy --name safe-base --chains base --expires 24h --deny-transfers` |
| `zerion agent list-policies` | List all policies | `zerion agent list-policies` |
| `zerion agent show-policy <id>` | Show policy details | `zerion agent show-policy safe-base` |
| `zerion agent delete-policy <id>` | Delete a policy | `zerion agent delete-policy safe-base` |

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

| Command | Description | Example |
|---------|-------------|---------|
| `zerion watch <address> --name <label>` | Add wallet to watchlist | `zerion watch 0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e --name ens-dao` |
| `zerion watch list` | List watched wallets | `zerion watch list` |
| `zerion watch remove <name>` | Remove from watchlist | `zerion watch remove ens-dao` |
| `zerion analyze <name>` | Analyze a watched wallet by name | `zerion analyze ens-dao` |

### Setup

| Command | Description | Example |
|---------|-------------|---------|
| `zerion init` | One-shot onboarding — install CLI globally, browser-auth via PKCE, install agent skills | `zerion init` |
| `zerion init -y` | Non-interactive init for CI; skips auth (run `zerion login` later) | `npx -y zerion-cli init -y` |
| `zerion login` | Browser-based login (PKCE) — opens dashboard.zerion.io and saves the key | `zerion login` |
| `zerion login --api-key zk_...` | Non-interactive login with a key you already have | `zerion login --api-key zk_dev_...` |
| `zerion logout` | Clear the saved API key and any agent tokens | `zerion logout` |
| `zerion setup skills` | Install Zerion agent skills into detected coding agents | `zerion setup skills` |
| `zerion setup skills --agent claude-code` | Install into a specific agent | `zerion setup skills --agent claude-code` |

### Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `zerion config set <key> <value>` | Set config (`apiKey`, `defaultWallet`, `defaultChain`, `slippage`) | `zerion config set defaultChain base` |
| `zerion config unset <key>` | Remove a config value (resets to default) | `zerion config unset defaultChain` |
| `zerion config list` | Show current configuration | `zerion config list` |

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
npm test                  # unit tests (fast, offline)
npm run test:integration  # live API tests (requires ZERION_API_KEY, runs serially to avoid rate limits)
npm run test:all          # both
node ./cli/zerion.js --help
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
- **Agent skills** — [`./skills/`](./skills/) (also installable via `npx skills add zeriontech/zerion-ai`)
- **Building with AI** — <https://developers.zerion.io/reference/building-with-ai>

## License

MIT — see [LICENSE](./LICENSE).
