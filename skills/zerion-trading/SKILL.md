---
name: zerion-trading
description: "Execute on-chain trading actions via the Zerion CLI: swap, bridge, and send tokens across 14 EVM chains and Solana. Use whenever the user asks to swap / trade / convert tokens, bridge across chains, or transfer tokens to an address. Always uses an API key + agent token (no pay-per-call). Pair with `zerion-agent-management` to set up tokens/policies first, and `zerion-analyze` to check positions before trading."
license: MIT
allowed-tools: Bash
---

# Zerion — Trading

Execute on-chain trading actions: swap, bridge, send. All commands build, sign, and broadcast a transaction in one shot using the active agent token as the signer passphrase.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the `zerion` umbrella skill. **All trading needs an API key + agent token.** Pay-per-call (`--x402`, `--mpp`) does NOT apply here.

## When to use

- "Swap X for Y" / "convert tokens" / "trade"
- "Bridge X to chain Y" (cross-chain)
- "Send tokens to address" (native ETH/SOL or ERC-20)

For balance checks before trading → `zerion-analyze`. For setting up an agent token → `zerion-agent-management`. For off-chain signing (permits, EIP-712) → `zerion-sign`.

## Pre-flight

```bash
zerion wallet list                       # confirm wallet exists, see active policies
zerion agent list-tokens                 # confirm agent token is set
```

If no agent token, the CLI offers an inline create-token prompt on the next trade attempt (TTY only). In CI / piped contexts, see `zerion-agent-management`.

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
| `--timeout <sec>` | Confirmation timeout (default 120s) |
| `--json` / `--pretty` / `--quiet` | Output mode (JSON default) |

## Pre-trade safety checklist

1. **Confirm the agent token is bound to the right wallet** — `zerion agent list-tokens` shows wallet bindings.
2. **Confirm policy allows the action** — `zerion agent list-policies` (e.g. `--deny-transfers` blocks raw `send`; `--chains base` blocks swaps on other chains).
3. **Slippage** — defaults to 2%. Tight (0.5%) for stable pairs, loose (3-5%) for low-liquidity tokens.
4. **Cross-chain timeout** — bridges can take 1-5 min. Use `--timeout 300` for slower routes.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `no_agent_token` | Trading needs an agent token | `zerion-agent-management` skill |
| `policy_denied` | Action blocked by an active policy | Check `agent show-policy <id>`; revise or use unrestricted token |
| `unsupported_chain` | Invalid chain | `zerion chains` |
| `insufficient_balance` | Not enough of `<from-token>` | `zerion portfolio --wallet <name>` to check |
| `quote_failed` | No route between tokens / chains | Try a different pair or chain |
| `slippage_exceeded` | Price moved beyond `--slippage` | Increase slippage or retry |
| `tx_timeout` | Confirmation didn't land within `--timeout` | Bump timeout, check tx hash on explorer |
| `invalid_destination` | Cross-chain destination missing or wrong format | Pass `--to-wallet <name>` or `--to-address <addr>` matching the `--to-chain` format |
