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

## Swap

```bash
# Same-chain swap (default chain from config)
zerion swap <from-token> <to-token> <amount>

# Specify source chain explicitly
zerion swap ETH USDC 0.1 --chain base

# Cross-chain swap (source = --chain, dest = --to-chain)
zerion swap ETH USDC 0.1 --chain base --to-chain arbitrum

# Custom slippage (default 2%)
zerion swap ETH USDC 0.1 --slippage 1

# Specific wallet (overrides defaultWallet)
zerion swap ETH USDC 0.1 --wallet <name>

# Bridge timeout for slow cross-chain swaps (default 120s)
zerion swap ETH USDC 0.1 --to-chain arbitrum --timeout 300
```

Tokens accepted as: symbol (`ETH`, `USDC`), 0x address, or full search match. Prefer 0x address when the symbol is ambiguous (multiple chains may have different USDCs).

```bash
# List swap-available tokens for a chain
zerion swap tokens                       # all chains
zerion swap tokens base                  # filter to Base
```

## Bridge

```bash
# Same-token bridge
zerion bridge <token> <to-chain> <amount> --from-chain <from-chain>

# Bridge + swap on destination
zerion bridge ETH arbitrum 0.1 --from-chain base --to-token USDC
```

## Send (transfer)

Native and ERC-20 transfers. Requires `--to <recipient>` and `--chain <chain>`.

```bash
zerion send ETH 0.01 --to 0x... --chain base
zerion send USDC 10 --to vitalik.eth --chain ethereum
```

The recipient can be a 0x address or ENS name (resolved at send time).

## Token search (resolve symbols → addresses)

```bash
zerion search <query>                    # by name, symbol, or address
zerion search PEPE --chain ethereum
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
| `--wallet <name>` | Specify wallet (default: from config) |
| `--chain <chain>` | Source chain |
| `--to-chain <chain>` | Destination chain (cross-chain swap) |
| `--from-chain <chain>` | Source chain for `bridge` |
| `--to <addr>` | Recipient address for `send` |
| `--slippage <pct>` | Slippage tolerance (default 2%) |
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
