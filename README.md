# Zerion CLI

CLI for [Zerion Wallet](https://zerion.io). Analyze wallets, sign, swap, and bridge on-chain with agent-managed wallets across EVM chains and Solana, all from the command line. Wallet management is built on the [Open Wallet Standard](https://github.com/open-wallet-standard/core).

> [!NOTE]
> **Alpha Preview** — This CLI is under active development. Commands, flags, and output formats may change or be removed without notice between releases. Do not depend on current behavior in production workflows.

## Installation

Set up everything in one command (install CLI globally, configure your API key, and add skills to your coding agents):

```bash
npx zerion-cli init
```

- authenticates in the browser via [dashboard.zerion.io](https://dashboard.zerion.io) and saves the key for you — no copy/paste
- detects your coding agent (Claude Code, Cursor, Codex, Gemini) and installs the Zerion skills globally
- add `-y` to skip the prompts: browser login, then every skill installed

On a remote or headless host, add `--no-open` to print the authorize URL instead of opening a browser. Without a terminal (CI, piped), `init` prints API-key instructions rather than waiting on a browser login — set `ZERION_API_KEY` there instead.

Or just install the CLI without setup:

```bash
npm install -g zerion-cli
```

The CLI is available as either `zerion` or `zerion-cli` — both run the same binary.

Requires Node.js 20 or later.

## Agent skill

One skill, [`zerion`](./skills/zerion/SKILL.md), under [`./skills/zerion/`](./skills/zerion/) — follows the [agentskills.io](https://agentskills.io) open standard. All capabilities and partner integrations live as nested files that load on demand (progressive disclosure), so a single install + single picker entry exposes everything below.

### Capabilities (`skills/zerion/capabilities/`)

| File | What it covers |
|------|----------------|
| [`analyze.md`](./skills/zerion/capabilities/analyze.md) | Portfolio, positions, history, PnL, token search, watchlist (read-only; supports x402 / MPP) |
| [`trading.md`](./skills/zerion/capabilities/trading.md) | Swap, bridge, send tokens (on-chain actions; needs API key + agent token) — plus the signing-route model: local signing vs. web-app handoff for human review |
| [`bundle.md`](./skills/zerion/capabilities/bundle.md) | Queue several actions into one signing session / one human review (`--prepare` + `bundle`) |
| [`sign.md`](./skills/zerion/capabilities/sign.md) | Off-chain signing — sign-message (EIP-191 / raw), sign-typed-data (EIP-712) |
| [`wallet.md`](./skills/zerion/capabilities/wallet.md) | Wallet management — create, import, add read-only, list, fund, review threshold, backup, export-key, delete, sync |
| [`agent-management.md`](./skills/zerion/capabilities/agent-management.md) | Agent tokens + policies (the autonomous-trading primitives) |
| [`swap-0x.md`](./skills/zerion/capabilities/swap-0x.md) | Token swaps via 0x API v2 — AllowanceHolder, Permit2, and Gasless flows across 20+ EVM chains |

### Partner integrations (`skills/zerion/partners/`)

Ecosystem partners that combine their product with the Zerion CLI. See [`partner-skill-creator.md`](./skills/zerion/partner-skill-creator.md) to contribute one. Loaded only when the user names the partner.

| File | What it covers | Partner |
|------|----------------|---------|
| [`bankr.md`](./skills/zerion/partners/bankr.md) | Twitter/X-native trading bot patterns | [Bankr](https://bankr.bot) |
| [`lifi-earn.md`](./skills/zerion/partners/lifi-earn.md) | Cross-chain yield routing | [Li.Fi](https://li.fi) |
| [`monad-addresses.md`](./skills/zerion/partners/monad-addresses.md) | Canonical Monad mainnet contract addresses for `zerion agent create-policy --allowlist` lockdown | [Monad](https://monad.xyz) |
| [`moonpay-onramp.md`](./skills/zerion/partners/moonpay-onramp.md) | Buy crypto with card or bank transfer via MoonPay, then trade with Zerion | [MoonPay](https://moonpay.com) |
| [`moonpay-iron.md`](./skills/zerion/partners/moonpay-iron.md) | USD bank-wire to Iron virtual account (IBAN/ACH) → USDC → DCA via Zerion | [MoonPay](https://moonpay.com) |
| [`moonpay-predict.md`](./skills/zerion/partners/moonpay-predict.md) | Trade prediction markets (Polymarket, Kalshi) via MoonPay CLI | [MoonPay](https://moonpay.com) |
| [`sendai-ideas.md`](./skills/zerion/partners/sendai-ideas.md) | Crypto idea discovery, validation, competitive landscape, DeFi TVL research | [SendAI](https://github.com/sendaifun/solana-new) (MIT) |
| [`somnia-blockchain.md`](./skills/zerion/partners/somnia-blockchain.md) | Somnia L1 reference — network info, gas model, deployment guidance | [Somnia](https://somnia.network) |
| [`somnia-reactivity.md`](./skills/zerion/partners/somnia-reactivity.md) | Somnia Reactivity — event-driven pub/sub, WebSocket + Solidity handlers | [Somnia](https://somnia.network) |
| [`trails-crosschainswap.md`](./skills/zerion/partners/trails-crosschainswap.md) | Cross-chain swaps to/from Polygon via Trails SDK (Widget / Headless / API) | [Trails](https://docs.trails.build) |
| [`trails-deposit.md`](./skills/zerion/partners/trails-deposit.md) | Bridge + DeFi vault deposit on Polygon in one intent (Aave, Morpho, ERC-4626) | [Trails](https://docs.trails.build) |
| [`umbra-privatetxn.md`](./skills/zerion/partners/umbra-privatetxn.md) | Private (stealth-address) transfers | [Umbra](https://umbra.cash) |
| [`uniswap-lp.md`](./skills/zerion/partners/uniswap-lp.md) | Liquidity position management | [Uniswap](https://uniswap.org) |
| [`uniswap-x402.md`](./skills/zerion/partners/uniswap-x402.md) | Swap with x402 pay-per-call | [Uniswap](https://uniswap.org) |
| [`vaultsfyi-*.md`](./skills/zerion/partners/) | Deposit, market intel, rebalance, risk monitor, strategist, watchlist, yield optimizer | [Vaults.fyi](https://vaults.fyi) |
| [`yellow-settlement-room.md`](./skills/zerion/partners/yellow-settlement-room.md) | Multiparty off-chain settlement rooms | [Yellow](https://yellow.org) |
| [`consolidate.md`](./skills/zerion/partners/consolidate.md) | Sweep all tokens on a chain into one target | Zerion |
| [`treasury-liquidation.md`](./skills/zerion/partners/treasury-liquidation.md) | Drain a wallet across all chains, and/or sweep a whole multi-chain portfolio into one token | Zerion |

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

### Install via Cursor

Install [`zerion-agent`](https://cursor.com/marketplace) from the Cursor Marketplace, or add the repo directly:

```text
Settings → Plugins → Add plugin → zeriontech/zerion-ai
```

The plugin ships the `zerion` skill plus the hosted Zerion API docs MCP server (`https://developers.zerion.io/mcp`), so the agent can look up endpoint reference without leaving the editor.

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

> Sell my USDC and DAI on Base into ETH — one signing session for both.

### Human review

> Ask me before anything over $500 from `bot-1`.

> Track my Ledger address as `cold` and swap 1 ETH to USDC from it — I'll sign in the browser.

### Wallet management

> Create a new encrypted wallet called `bot-1`.

> Set up an agent token for `bot-1` that's allowed to swap on Base only, with a 7-day expiry.

> List my wallets and which agent tokens are active.

### Signing

> Sign the EIP-712 message in `typed.json` using my `bot-1` wallet.

The agent reaches for the `zerion` skill, which routes by task to the right nested file under `capabilities/` or `partners/`. Progressive disclosure means only the matching capability doc loads — context stays clean. A "create wallet, set up agent token, then swap" flow Reads `capabilities/wallet.md` → `capabilities/agent-management.md` → `capabilities/trading.md` in sequence.

## Manual setup, agent execution

Zerion CLI splits into two surfaces, by design.

- **Wallet management and agent token setup are manual.** `wallet create`, `import`, `backup`, `export-key`, and `delete` all prompt for a passphrase. `wallet sync` emits a QR code you scan with the Zerion app. `agent create-token` mints a scoped trading credential bound to a specific wallet, and `agent create-policy` attaches the rules it has to obey — allowed chains, expiry, transfer/approval gates, contract allowlists. The sibling admin commands (`agent list-tokens`, `use-token`, `revoke-token`, `list-policies`, `show-policy`, `delete-policy`) are also gestures you make yourself. No key material moves and no spending credential widens without you in the loop. For CI and headless servers, `agent create-token` accepts `--passphrase-file <path>` (file must be mode `0600`) so token issuance can be scripted without an interactive TTY — see [`capabilities/agent-management.md`](./skills/zerion/capabilities/agent-management.md).
- **Analysis, signing, trading, and discovery are for agents.** `analyze`, `portfolio`, `positions`, `history`, `pnl`, `sign-message`, `sign-typed-data`, `swap`, `bridge`, `send`, `swap tokens`, `search`, `chains`, `wallet list`, `wallet fund`, and `watch list` emit JSON to stdout, structured errors to stderr, and skip confirmation dialogs. Once an agent token is configured, signing and trading fire immediately — the token authorizes operations on behalf of the wallet without a passphrase prompt.
- **You can put yourself back in the loop, per wallet.** Unattended signing is the default, not the only mode: a **read-only wallet** (`wallet add` — an address with no keys here) or a **review threshold** (`wallet set-review-threshold`) sends the affected transactions to the Zerion web app for a human to review and sign in a browser, instead of auto-signing. Agent policies say what the token may never do; the review threshold says what you want to be asked about. See [Signing routes](#signing-routes--local-signing-vs-web-app-handoff).

Setup gestures (`init`, `setup skills`, `config set/unset/list`, `watch` add/remove) are one-time configuration steps you run yourself before automation takes over.

The split is the point. You stage by hand once — create or import a wallet, set a passphrase, mint an agent token, attach a policy — then hand the agent token to an automation that can only do what the policy allows. Treat agent tokens like API keys with spending power; use [agent policies](#agent-policies) to scope them down to specific chains, addresses, or expiry windows.

## Authentication

Three options. The CLI auto-detects which is active.

### A) API key (recommended)

Get a key at **[dashboard.zerion.io](https://dashboard.zerion.io)** — it's free and takes a minute. Keys begin with `zk_`.

The fastest way is **browser login** — like `claude` or `gh auth login`, it opens the dashboard, you approve, and the key is captured over a local loopback redirect and saved to config. The key never leaves your machine.

```bash
zerion login              # pick browser login, paste a key, or pay-per-call
zerion login --browser    # go straight to browser authentication
```

Or set / persist a key manually:

```bash
export ZERION_API_KEY="zk_..."     # per-session
zerion config set apiKey zk_...    # persisted to ~/.zerion/config.json
```

- HTTP Basic Auth
- Required for analysis and trading commands (analysis can also use x402 / MPP pay-per-call instead — see options B and C)

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
| `zerion positions <address\|ens>` | Token + DeFi positions (`--positions all\|simple\|defi`, or `--defi` for grouped-by-protocol view with loans netted) | `zerion positions vitalik.eth --defi` |
| `zerion history <address\|ens>` | Transaction history (`--limit`, `--chain`) | `zerion history vitalik.eth --limit 10 --chain ethereum` |
| `zerion pnl <address\|ens>` | Profit & loss (realized, unrealized, fees) | `zerion pnl vitalik.eth` |
| `zerion search <query>` | Search tokens by name or symbol | `zerion search USDC` |
| `zerion chains` | List supported chains | `zerion chains` |

### Trading

Requires an API key (or agent token for unattended use).

| Command | Description | Example |
|---------|-------------|---------|
| `zerion swap <chain> <amount> <from-token> <to-token>` | Same-chain swap | `zerion swap base 1 USDC ETH` |
| `zerion swap solana <amount> <from-token> <to-token>` | Solana same-chain swap | `zerion swap solana 0.1 SOL USDC` |
| `zerion swap tokens [chain]` | List tokens available for swap | `zerion swap tokens solana` |
| `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>` | List all bridge providers (no execute, multi-offer case) | `zerion bridge base USDC 5 arbitrum USDC` |
| `zerion bridge … --cheapest` | Execute highest-output bridge route | `zerion bridge base USDC 5 arbitrum USDC --cheapest` |
| `zerion bridge … --fast` | Execute lowest-time bridge route | `zerion bridge base USDC 5 arbitrum USDC --fast` |
| `zerion bridge … --to-wallet <name>` | Bridge with explicit destination wallet (Solana ↔ EVM) | `zerion bridge ethereum USDC 5 solana USDC --to-wallet sol-bot --cheapest` |
| `zerion bridge … --to-address <addr>` | Bridge to a raw destination address | `zerion bridge ethereum USDC 5 solana USDC --to-address 8xLdox… --cheapest` |
| `zerion send <token> <amount> --to <address> [--chain <chain>]` | Send tokens (chain auto-detected from address format) | `zerion send usdc 50 --to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain base` |
| `zerion send SOL <amount> --to <solana-pubkey>` | Send native SOL on Solana | `zerion send SOL 0.1 --to 2Nsnn…` |
| `zerion <send\|swap\|bridge\|consolidate> … --prepare` | Build + gate a command but print a prepared-group envelope (JSON) instead of executing — for `zerion bundle` | `zerion swap base 100 USDC ETH --prepare` |
| `zerion bundle --group <envelope> [--group …]` | Sign several prepared groups together — one web-app handoff when any group needs review, else locally. Same signer address (chains may differ); per-group results; always exits 0 | `zerion bundle --group "$(zerion swap base 100 USDC ETH --prepare)" --group "$(zerion send USDC 20 --to 0xBob --chain base --prepare)"` |

### Signing routes — local signing vs. web-app handoff

Every trade (and every message signature) takes one of two routes, decided automatically **before**
anything is signed:

- **Local signing (default)** — the CLI signs with the agent token as passphrase and broadcasts. One shot, unattended.
- **Web-app handoff** — the CLI encodes the transaction into an `app.zerion.io` link, opens a browser,
  and **blocks** until a human signs there (default 300s, `--timeout` to change). The URL is also printed to
  stderr, so headless/agent environments can hand it to the user. Nothing is signed locally; no agent token needed.

The handoff fires when any trigger hits:

| Trigger | Set by |
|---------|--------|
| Read-only wallet (no key material) | `zerion wallet add <address\|ens> --name <name>` |
| Sell-side USD value over the wallet's review threshold — **trades only** | `zerion wallet set-review-threshold <wallet> <usd\|off>` |
| Explicit force | `--review` |

Messages have no USD value, so `sign-message` / `sign-typed-data` ignore the threshold — only the
read-only and `--review` triggers apply there.

Both routes run the same pre-flight (balance gates, blocking-quote checks, agent policies), and every
trade prints `Signing route: <route> — <reason>` to stderr plus `signedVia: "local" | "web-app"` in its
JSON output. If a threshold is set but the value can't be priced, the trade **fails closed** to review.
A handoff ends `completed` / `rejected` / `failed` / `timeout` (or `aborted` on Ctrl-C), reported as
`status` in that same JSON — only `completed` exits 0.

The threshold is a **per-transaction** ceiling. `consolidate --execute` is therefore always local: a sweep
is N independent transactions, and rows that are each under the threshold don't aggregate into a review
(it also needs key material, so it can't run on a read-only wallet). To have a whole sweep judged and
signed as one entity, run it through
`zerion bundle --group "$(zerion consolidate <chain> <token> --prepare)"`. Full reference:
[`capabilities/trading.md`](./skills/zerion/capabilities/trading.md) and
[`capabilities/bundle.md`](./skills/zerion/capabilities/bundle.md).

### Wallet Management

**Keystore wallets** (encrypted on this machine), plus **read-only wallets** that sign via the web app. EVM + Solana supported. Passphrase required for all destructive ops.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion wallet create --name <name>` | Create encrypted wallet (EVM + Solana) | `zerion wallet create --name trading-bot` |
| `zerion wallet import --name <name> --evm-key` | Import from EVM private key (interactive) | `zerion wallet import --name old-wallet --evm-key` |
| `zerion wallet import --name <name> --sol-key` | Import from Solana private key (interactive) | `zerion wallet import --name sol-bot --sol-key` |
| `zerion wallet import --name <name> --mnemonic` | Import from seed phrase (all chains) | `zerion wallet import --name backup --mnemonic` |
| `zerion wallet add <address\|ens> --name <name>` | Add a read-only wallet — address only, no keys (0x, ENS, or Solana base58). Reads work normally; **all signing hands off to the web app** | `zerion wallet add vitalik.eth --name vitalik` |
| `zerion wallet set-review-threshold <wallet> <usd\|off>` | Route trades whose sell-side value exceeds `<usd>` to the web app for human review instead of auto-signing (`off` clears it) | `zerion wallet set-review-threshold trading-bot 500` |
| `zerion wallet list` | List all wallets (keystore + read-only) | `zerion wallet list` |
| `zerion wallet fund` | Show deposit addresses for funding | `zerion wallet fund --wallet trading-bot` |
| `zerion wallet backup --wallet <name>` | Export recovery phrase | `zerion wallet backup --wallet trading-bot` |
| `zerion wallet export-key --wallet <name> [--chain evm\|solana\|all] [--index N]` | Export raw private key(s) derived from mnemonic — EVM (0x hex) and/or Solana (base58 Phantom format + 32-byte ed25519 seed). Output is stderr-only. | `zerion wallet export-key --wallet trading-bot --chain evm` |
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
| `zerion agent create-token --name <bot> --wallet <wallet>` | Create scoped token (interactive passphrase) | `zerion agent create-token --name dca-bot --wallet trading-bot` |
| `zerion agent create-token … --passphrase-file <path>` | Non-interactive: passphrase read from a `chmod 600` file (CI / headless) | `zerion agent create-token --name dca-bot --wallet trading-bot --policy <id> --passphrase-file /run/zerion/pass` |
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
| `zerion login` | Authenticate — browser (dashboard) login, paste an API key, or pay-per-call | `zerion login` |
| `zerion login --browser` | Browser auth: opens dashboard.zerion.io, captures the key via loopback | `zerion login --browser` |
| `zerion init` | One-shot onboarding — install CLI globally, browser login, install agent skills | `npx zerion-cli init` |
| `zerion init -y` | Same, without prompts: browser login, then install every skill | `zerion init -y` |
| `zerion init --no-open` | Print the authorize URL instead of opening a browser (remote / headless) | `zerion init --no-open` |
| `zerion setup skills` | Install Zerion agent skills into detected coding agents | `zerion setup skills` |
| `zerion setup skills --agent claude-code` | Install into a specific agent | `zerion setup skills --agent claude-code` |

### Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `zerion config set <key> <value>` | Set config (`apiKey`, `defaultWallet`, `defaultChain`, `slippage`) | `zerion config set defaultChain base` |
| `zerion config unset <key>` | Remove a config value (resets to default) | `zerion config unset defaultChain` |
| `zerion config list` | Show current configuration | `zerion config list` |

Per-wallet review thresholds also live in `~/.zerion/config.json`, but are set with their own command
rather than `config set` — see [`zerion wallet set-review-threshold`](#wallet-management).

## Global Flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Source wallet (default: from config) |
| `--address <addr\|ens>` | Use raw address or ENS name |
| `--watch <name>` | Use watched wallet by name |
| `--chain <chain>` | Chain for analysis commands (default: `ethereum`) |
| `--to-wallet <name>` | Destination wallet for `bridge` (Solana ↔ EVM) |
| `--to-address <addr>` | Destination address for `bridge` (must match destination-chain format) |
| `--positions all\|simple\|defi` | Filter positions type |
| `--defi` | On `positions`: shorthand for `--positions defi` with output grouped by protocol (LP tokens pooled by `group_id`, loans netted in `net_value`) |
| `--limit <n>` | Limit results (default: 20 for list ops) |
| `--offset <n>` | Skip first N results (pagination) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--review` | Force this trade to the web app for human review instead of auto-signing (see [Signing routes](#signing-routes--local-signing-vs-web-app-handoff)) |
| `--prepare` | On `send`/`swap`/`bridge`/`consolidate`: print a prepared-group envelope instead of executing — the input to `zerion bundle` |
| `--timeout <sec>` | Wait budget: broadcast confirmation on the local route (default 120), or the browser-callback wait on a web-app handoff (default 300) |
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
- a web-app handoff the human rejected, or that timed out waiting for the browser callback

All errors are emitted as structured JSON on stderr with a `code` field.

## Development

```bash
npm install
npm test                  # unit tests (fast, offline)
npm run test:integration  # live API tests (requires ZERION_API_KEY, runs serially to avoid rate limits)
npm run test:all          # both
node ./cli/zerion.js --help
```

Development requires **npm >=11.10** (see Supply-chain cooldown below); CI and `npm publish` run on Node 24.

### Supply-chain cooldown

To reduce exposure to npm supply-chain attacks, this repo enforces a **release-age cooldown**: `npm install` will only resolve dependency versions that have been published for at least a fixed number of days. Compromised "fresh" releases are usually detected and unpublished within that window.

The cooldown length is set by `min-release-age` in [`.npmrc`](./.npmrc) — that line is the single source of truth for the window. It requires **npm >=11.10** (older npm silently ignores it); `devEngines` in `package.json` pins npm to that range with `onFail: error`, so an unsupported npm hard-fails instead of quietly skipping the cooldown.

The cooldown only affects version _resolution_ (i.e. updating `package-lock.json`); a plain install from the existing lockfile — including `npm ci` in CI — is unaffected.

**Overriding for an urgent fix.** If you need a security patch newer than the window, bypass it for a single install and commit the result:

```bash
npm install <package>@<version> --min-release-age=0
```

Then commit the updated `package-lock.json` with a note explaining why.

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
- `.github/workflows/publish-next.yml` publishes prereleases to the `next` dist-tag (see below)

### Prerelease channel (`@next`)

Every push to `main` (except release commits) publishes a prerelease to npm under the `next` dist-tag, e.g. `1.5.1-next.20260714093000.g325093a`. Regular users are unaffected: `npm install zerion-cli` keeps resolving the `latest` tag, which only moves when a release-please release PR is merged.

To try the latest merged-but-unreleased work:

```bash
npx zerion-cli@next --help
# or
npm install -g zerion-cli@next
```

To test an unmerged branch, install straight from git — no publish needed:

```bash
npm install -g github:zeriontech/zerion-ai#<branch>
```

A prerelease can also be published from any branch manually via the **Publish next** workflow in the Actions tab (`workflow_dispatch`).

If a `next` build turns out broken, point the tag back at a known-good version:

```bash
npm dist-tag add zerion-cli@<version> next
```

## Resources

- **API documentation** — <https://developers.zerion.io/introduction>
- **Get an API key** — <https://dashboard.zerion.io>
- **Agent skills** — [`./skills/`](./skills/) (also installable via `npx skills add zeriontech/zerion-ai`)
- **Building with AI** — <https://developers.zerion.io/reference/building-with-ai>

## License

MIT — see [LICENSE](./LICENSE).
