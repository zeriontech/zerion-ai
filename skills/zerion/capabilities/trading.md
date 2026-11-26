
# Zerion — Trading

Execute on-chain trading actions: swap, bridge, send. Each command builds a fully-formed transaction and then either **signs locally** (agent token as passphrase, broadcast + confirm in one shot) or **hands off to the web app** for human review — see "Signing routes & web-app handoff" below. To queue several actions into one signing session, see `capabilities/bundle.md`.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

For auth see the parent `SKILL.md` (Setup + Authentication). **All trading needs an API key + agent token.** Pay-per-call (`--x402`, `--mpp`) does NOT apply here.

## When to use

- "Swap X for Y" / "convert tokens" / "trade"
- "Bridge X to chain Y" (cross-chain)
- "Send tokens to address" (native ETH/SOL or ERC-20)
- "Send from my Safe" / "propose a Safe transaction" / "what's pending on my Safe?"

For balance checks before trading → `capabilities/analyze.md`. For setting up an agent token → `capabilities/agent-management.md`. For off-chain signing (permits, EIP-712) → `capabilities/sign.md`. To sign several actions together → `capabilities/bundle.md`.

## Signing routes & web-app handoff

Every trade is signed one of two ways, decided automatically **before** any transaction is signed
or broadcast (both routes run the same balance / `quote.blocking` / policy pre-flight):

- **Local signing (default)** — the CLI signs with the agent token as passphrase, broadcasts, and
  waits for confirmation. This is the one-shot path.
- **Web-app handoff** — instead of signing locally, the CLI builds the transaction, encodes it into
  an `app.zerion.io` link, opens the browser (the URL is also **printed to stderr** so headless
  / agent environments can open it manually), and waits for a localhost callback with the result.
  A connected wallet signs in the browser; the CLI verifies the returned hash on-chain before
  reporting success.

The handoff fires when any trigger hits:

| Trigger | Meaning |
|---|---|
| Read-only wallet | The saved wallet has no key material (added with `wallet add`), so every signature routes here. |
| Value over threshold | The trade's sell-side USD value exceeds the wallet's review threshold. **Trades only** — messages have no sell-side value, so `sign-message` / `sign-typed-data` ignore the threshold. |
| `--review` | Force review regardless of value. |

Applies to `swap` / `bridge` / `send` on **both EVM and Solana**, and to message signing
(`capabilities/sign.md`). `consolidate` participates via `--prepare` + `bundle` (ADR-0005) rather
than a direct handoff — `consolidate --execute` **always signs locally** and never consults the route
(the threshold is a per-transaction ceiling; a sweep is N independent transactions, so under-threshold
rows don't aggregate into a review). It needs key material: on a read-only wallet every row fails.
Route a whole sweep through review with
`zerion bundle --group "$(zerion consolidate <chain> <token> --prepare)"` — see `partners/consolidate.md`.
The CLI prints `Signing route: <route> — <reason>` to stderr on every trade, and the JSON on stdout
carries `signedVia: "local" | "web-app"` — parse that field to tell which route actually ran.
`--timeout` controls how long the handoff waits for the browser callback (default 300s).

**Value is fail-closed.** If a threshold is set but the sell-side value can't be priced, the trade
routes to review rather than auto-signing — an unpriced token is not a bypass.

**Plan for it when unattended.** On the handoff route the command blocks until a human signs in the
browser, so a cron / CI agent cannot complete it alone. Read the wallet's type and threshold first
(`zerion wallet list`, `capabilities/wallet.md`), and surface the stderr URL to the user instead of
assuming a browser opened. A handoff ends in exactly one terminal outcome, reported as `status` in the
same JSON: `completed`, `rejected` (the human declined), `failed` (the browser reported an error, or a
returned hash failed verification), `timeout` (no callback within `--timeout`), or `aborted` (Ctrl-C —
the transaction may still complete in the browser). **Only `completed` exits 0**; every other outcome
exits non-zero with a structured error on stderr.

**`--prepare`** on any of these commands runs the full build + gate pipeline but prints a nonce-free
**prepared-group** envelope to stdout instead of executing — the input to `zerion bundle`, which
signs several prepared groups together. Full reference: `capabilities/bundle.md`.

## Pre-flight

```bash
zerion wallet list                       # confirm wallet exists, see active policies
zerion agent list-tokens                 # confirm agent token is set
```

If no agent token, the CLI offers an inline create-token prompt on the next trade attempt (TTY only). In CI / piped contexts, pre-create the token with `zerion agent create-token --passphrase-file <0600-path>` — see `capabilities/agent-management.md`.

## Swap (same-chain)

Convert one token to another **on the same chain**. For cross-chain conversion use `bridge`.

```bash
# zerion swap <chain> <amount> <from-token> <to-token>
zerion swap base 1 USDC ETH
zerion swap ethereum 0.1 ETH USDC
zerion swap arbitrum 100 USDC DAI
zerion swap monad 1 USDC MON

# Solana same-chain swap
zerion swap solana 0.1 SOL USDC

# Specific wallet (overrides defaultWallet)
zerion swap base 1 USDC ETH --wallet <name>

# Custom slippage (default 2%, max 3%)
zerion swap base 1 USDC ETH --slippage 3

# Confirmation timeout (default 120s)
zerion swap base 1 USDC ETH --timeout 300
```

Tokens accepted as: symbol (`ETH`, `USDC`, `SOL`), 0x address (EVM), Solana mint, or full search match. Prefer the explicit address when the symbol is ambiguous.

```bash
# List swap-available tokens for a chain
zerion swap tokens                       # all chains
zerion swap tokens base                  # filter to Base
zerion swap tokens solana                # filter to Solana
zerion swap tokens monad                 # filter to Monad
```

## Bridge (cross-chain)

Move (and optionally swap) tokens **between chains**. Bridge with the same token on both sides for a pure transfer; pass a different `to-token` for bridge + swap.

**Provider selection:**

| Flag | Behavior |
|---|---|
| _(none)_, multi-offer | List every quote (provider, output, time, fee) and exit. **No transaction is signed.** |
| _(none)_, single-offer | Auto-execute the only available route (no choice to make). |
| `--cheapest` | Execute the highest-output offer (matches the legacy auto-execute behavior). |
| `--fast` | Execute the lowest-time offer (`estimated_time_seconds`). Falls back to `--cheapest` if no offer carries time data. |

Rules:
- `--fast` and `--cheapest` together is rejected.
- Supported flag forms: bare `--fast` (must be last on the command line so `parseFlags` doesn't consume the next positional as the value), `--fast=true` / `--fast=false`, and `--no-fast` (equivalent to `--fast=false`). Same shape applies to `--cheapest`. Anything else (e.g. `--fast=cheapest`, `--fast arbitrum`) errors with `invalid_flag_value`.
- `--slippage` is validated: must be a number between 0 and 100. `--slippage=abc`, `--slippage=2abc`, `--slippage=-5`, `--slippage=200` all reject with `invalid_slippage`. Strict numeric parse — no partial-string matches.

```bash
# zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token> [--fast | --cheapest]

# List all bridge providers (no execution) — agent can compare and choose
zerion bridge base USDC 5 arbitrum USDC

# Same-token bridge — execute the cheapest (highest output) route
zerion bridge base USDC 5 arbitrum USDC --cheapest
zerion bridge ethereum USDC 100 polygon USDC --cheapest
zerion bridge base USDC 10 monad USDC --cheapest

# Execute the fastest route (lowest estimated_time_seconds)
zerion bridge base USDC 5 arbitrum USDC --fast

# Bridge + swap on destination
zerion bridge base USDC 5 arbitrum ETH --cheapest
zerion bridge base USDC 5 monad MON --cheapest

# Native token bridge
zerion bridge base ETH 0.001 optimism ETH --cheapest

# Bridge EVM → Solana (mnemonic wallet has both accounts → no extra flag needed)
zerion bridge ethereum USDC 50 solana USDC --cheapest

# Bridge Solana → EVM
zerion bridge solana USDC 50 ethereum USDC --cheapest

# Cross-format bridge to a different local wallet
zerion bridge ethereum USDC 50 solana USDC --to-wallet <sol-wallet> --cheapest
zerion bridge solana USDC 50 ethereum USDC --to-wallet <evm-wallet> --cheapest

# Bridge to a raw destination address (must match the target chain's format)
zerion bridge ethereum USDC 50 solana USDC --to-address <solana-pubkey> --cheapest
zerion bridge solana USDC 50 ethereum USDC --to-address 0x... --cheapest

# Slippage / timeout flags work the same as swap (strategy flag still last)
zerion bridge base USDC 5 arbitrum ETH --slippage 3 --timeout 300 --cheapest
```

### Cross-chain destination rules

For Solana ↔ EVM bridges (different address formats), the destination receiver is resolved in this priority order:

1. `--to-address <addr>` — raw recipient. Must match the target chain's format (`0x…` for EVM, base58 pubkey for Solana). ENS names allowed for EVM.
2. `--to-wallet <name>` — local wallet whose corresponding account on the target chain is used.
3. Fallback — the source wallet itself, if it has an account on the target chain (true for any mnemonic-derived wallet).

The destination wallet must have an account that satisfies the target chain. EVM-only wallets cannot receive on `solana`; Solana-only wallets cannot receive on EVM chains.

> If the API returns `swap cannot be performed with the given parameters`, the route doesn't currently exist for the requested pair. Verify the token has implementations on both chains (`zerion search <symbol>`), try a different amount, and confirm both chains support bridging (`zerion chains`).

## Send (transfer)

Native + ERC-20 + native SOL transfers. `--chain` is auto-inferred from the recipient address format when not passed (`0x…` → ethereum default, base58 → solana).

```bash
# EVM: native + ERC-20
zerion send ETH 0.01 --to 0x... --chain base
zerion send USDC 10 --to vitalik.eth --chain ethereum
zerion send MON 0.5 --to 0x... --chain monad
zerion send USDC 10 --to 0x... --chain monad

# Solana: native SOL (chain auto-detected from base58 recipient)
zerion send SOL 0.1 --to 2Nsnn…
zerion send SOL 0.1 --to 2Nsnn… --chain solana   # explicit form
```

Recipients accepted: 0x address (EVM), ENS name (resolved at send time), Solana base58 pubkey. SPL token sends on Solana are not yet supported via the CLI — convert to SOL first with `zerion swap solana <amount> <token> SOL`.

### Send from a Safe

A **Safe wallet** (`capabilities/wallet.md` § Safe wallets) can `send` native tokens and ERC-20s on EVM
chains — nothing else. One run collects **one** owner signature, from a registered signer:

```bash
zerion send USDC 10 --to 0x... --chain base --wallet treasury                    # single signer
zerion send ETH 0.1 --to 0x... --chain base --wallet treasury --signer ledger    # pick one of several signers
zerion send ETH 0.1 --to 0x... --chain base --wallet treasury --propose-only     # never execute, only propose
zerion send ETH 0.1 --to 0x... --chain base --wallet treasury --nonce next       # use the Safe's on-chain nonce
zerion send ETH 0.1 --to 0x... --chain base --wallet treasury --nonce 42         # replace the queued tx at nonce 42
zerion send ETH 0.1 --to 0x... --chain base --wallet treasury --review --sign-mode hash   # sign the safeTxHash in the browser
```

What happens:

- **Executes** when that one signature meets the Safe's threshold (a **1-of-N** Safe), the nonce is the
  Safe's on-chain nonce, and `--propose-only` is not set. The executor (`--executor` at `add-safe`, else the
  signer) sends `execTransaction` and pays the gas; the Safe pays only the amount sent.
- **Proposes** otherwise, to the chain's Safe Transaction Service; the other owners confirm and execute in
  the Safe app (`link` in the output). The CLI never co-signs with the executor and cannot confirm or execute
  someone else's proposal yet.
- **Refuses before signing** on a chain with no Safe Transaction Service when it can't execute
  (`safe_threshold_unreachable_no_tx_service`).
- On a chain that has a Safe Transaction Service, a send that would **propose** (`--propose-only`, a threshold
  above 1, or a `--nonce` ahead of the chain) needs your Safe API key: `zerion config set safeApiKey <key>` or
  `SAFE_API_KEY`. Missing → `safe_api_key_missing`, before any signing. A 1-of-N send that **executes** needs
  no key: without one it skips the service's queue, executes at the on-chain nonce, and warns on stderr that
  queued proposals were not checked (executing invalidates any queued proposal at that nonce).
- The signer signs on the usual route: locally with **its** agent token, or in the web app when it is a
  read-only wallet, `--review` is passed, or the value is over the review threshold (the Safe's, else the
  signer's). The signer's agent-token policies run on the transfer itself, on both routes.
- `--sign-mode hash` (web app only) signs the safeTxHash with eth_sign — use it when the wallet can't sign
  EIP-712 typed data. The default is `typed`.
- Default nonce: one past the highest pending proposal, or the on-chain nonce if none (or if no Safe API key is
  set). If the service returns a full page of 100 pending proposals, pass `--nonce` yourself (`safe_queue_truncated`).
- There is **no simulation** in the CLI. The web-app review shows Zerion's Safe simulation on ethereum, base,
  arbitrum, optimism and polygon; elsewhere a failing transfer is caught only when it reverts at execution
  (atomically — no funds move, the executor loses the gas).

Output: the usual `send` summary plus a `safe` object —
`{ chain, safe, safeTxHash, nonce, status: "executed"|"proposed", confirmations: "1/<threshold>", link, txHash?, signedVia, signMode, route }`.
`txHash` is present only when executed. Each successful run also writes a local receipt under
`~/.zerion/safe-pending/<safe>/<chainId>/`.

**Refused on a Safe wallet** (`safe_unsupported_command`): `swap`, `bridge`, `consolidate`, `bundle`, any
`--prepare`, `sign-message`, `sign-typed-data`, and `send` on Solana.

**Safe-only flags** (`safe_only_flag`): `send` from a keystore or read-only wallet refuses `--signer`, `--nonce`,
`--propose-only` and `--sign-mode` before reading the chain, signing or broadcasting.

### Safe info & queue (read-only)

```bash
zerion safe info --wallet treasury                 # every chain cached at add-safe time
zerion safe info --wallet treasury --chain base    # version, owners, threshold, nonce, guard, modules, tx-service
zerion safe queue --wallet treasury --chain base   # pending Safe transactions
```

- `safe queue` reads the Safe Transaction Service from the Safe's **on-chain nonce** up (needs the Safe API
  key) and merges local receipts. Each entry has `confirmations` (`k/threshold`), `stale` (nonce below the
  on-chain nonce — it can never execute), `conflict` (two entries share a nonce), `source`
  (`tx-service`/`local`/`both`) and the decoded `call` (`native`, `erc20-transfer`, or `raw`).
- A full page of 100 sets `truncated: true` on that chain (and warns on stderr): more may be pending.
- A chain that can't be read becomes `{ chain, error }`; the command still exits 0. Parse each row.
- `--wallet` defaults to `defaultWallet`; a non-Safe wallet → `not_a_safe`.

## Token search (resolve symbols → addresses)

```bash
zerion search <query>                    # by name, symbol, or address
zerion search PEPE --chain ethereum
zerion search MON --chain monad
zerion search "uniswap" --limit 5
```

## Chain validation

```bash
zerion chains                            # full chain catalog
```

Use this to confirm a chain ID is supported before passing `--chain` / `--to-chain` / `--from-chain`.

## Output & global flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Source wallet (default: from config) |
| `--to-wallet <name>` | Destination wallet for `bridge` (Solana ↔ EVM) |
| `--to-address <addr>` | Destination address for `bridge` (chain-format must match destination chain) |
| `--to <addr>` | Recipient address for `send` |
| `--slippage <pct>` | Slippage tolerance (default 2%, max 3%) |
| `--timeout <sec>` | Wait budget. On the **local** route: broadcast-confirmation timeout (default **120s**). On the **web-app handoff**: how long to wait for the browser callback (default **300s**) |
| `--review` | Force the web-app handoff regardless of value (`capabilities/bundle.md`) |
| `--prepare` | Print a prepared-group envelope instead of executing — for `zerion bundle` (`capabilities/bundle.md`) |
| `--quote` | CLI 1.11.0+ (older versions ignore it and execute). Price only, then stop. Skips the balance check, so it prices tokens the wallet doesn't hold yet (`enoughBalance: false`); without the tokens the API leaves out network gas and the protocol fee, so treat that price as indicative and re-quote once they arrive. On `bridge` it always lists every route instead of executing — even a single route, which plain `bridge` would execute. Can't be combined with `--prepare` |
| `--json` / `--pretty` / `--quiet` | Output mode (JSON default) |

## Pre-trade safety checklist

1. **Confirm the agent token is bound to the right wallet** — `zerion agent list-tokens` shows wallet bindings.
2. **Confirm policy allows the action** — `zerion agent list-policies` (e.g. `--deny-transfers` blocks raw `send`; `--chains base` blocks swaps on other chains).
3. **Slippage** — defaults to 2%. Tight (0.5%) for stable pairs, loose (3-5%) for low-liquidity tokens.
4. **Cross-chain timeout** — bridges can take 1-5 min. Use `--timeout 300` for slower routes.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `no_agent_token` | Trading needs an agent token | `capabilities/agent-management.md` skill |
| `policy_denied` | Action blocked by an active policy | Check `agent show-policy <id>`; revise or use unrestricted token |
| `unsupported_chain` | Invalid chain | `zerion chains` |
| `insufficient_balance` | Not enough of `<from-token>` | `zerion portfolio --wallet <name>` to check |
| `quote_failed` | No route between tokens / chains | Try a different pair or chain |
| `slippage_exceeded` | Price moved beyond `--slippage` | Increase slippage or retry |
| `tx_timeout` | Confirmation didn't land within `--timeout` | Bump timeout, check tx hash on explorer |
| `invalid_destination` | Cross-chain destination missing or wrong format | Pass `--to-wallet <name>` or `--to-address <addr>` matching the `--to-chain` format |
| `safe_unsupported_command` | A Safe wallet used with anything but EVM `send` | Use a keystore or read-only wallet |
| `safe_only_flag` | `--signer`, `--nonce`, `--propose-only` or `--sign-mode` on a `send` from a non-Safe wallet | Drop the flag, or `--wallet <safe>` |
| `safe_signer_required` / `safe_signer_not_registered` | Safe has several signers and no `--signer`, or `--signer` isn't one of them | Pass `--signer` with a registered signer |
| `safe_signer_not_owner` | The signer is no longer an owner of the Safe on this chain | `zerion safe info --chain <chain>`; use a current owner |
| `safe_api_key_missing` | Chain has a Safe Transaction Service, no Safe API key is set, and the send would propose | `zerion config set safeApiKey <key>` or `SAFE_API_KEY` |
| `safe_threshold_unreachable_no_tx_service` | Run can't execute and the chain has no Safe Transaction Service | Not supported for multi-owner Safes on this chain yet |
| `safe_nonce_stale` | The nonce is below the Safe's on-chain nonce (requested, or used while signing) | Retry without `--nonce`, or `--nonce next` |
| `safe_nonce_not_executable` | `--nonce` ahead of the chain where no Safe Transaction Service exists | `--nonce next` |
| `safe_queue_truncated` | 100+ pending proposals, so the next nonce is unknown | Pass `--nonce <n>` or `--nonce next` |
| `safe_executor_insufficient_gas` | The executor can't pay for `execTransaction` | Fund the executor, or `--propose-only` |
| `safe_sign_rejected` / `safe_sign_failed` | The owner rejected or the wallet failed in the web app (`reason` in the message) | For typed-data trouble, retry with `--review --sign-mode hash` |
| `sign_mode_requires_review` | `--sign-mode hash` on the local route | Add `--review` |
| `safe_execute_failed` | `execTransaction` reverted, or the web-app execution didn't complete | Check balances and `zerion safe queue` |
| `safe_tx_service_error` | The Safe Transaction Service failed; for a proposal the outcome may be unknown | `zerion safe queue` before retrying |
