---
name: zerion-analyze
description: "Read-only crypto wallet insights via the Zerion CLI: portfolio value, token holdings, DeFi positions, transaction history, PnL, and watchlist management. Use whenever the user asks 'what's in this wallet', 'how is X doing', portfolio/PnL/positions/transactions for any address, ENS name, local wallet, or watched address. Supports x402 / MPP pay-per-call. Pair with `zerion-trading` for execution after analysis."
license: MIT
allowed-tools: Bash
---

# Zerion — Wallet Analysis

Read-only insights into any crypto wallet across 14 EVM chains and Solana. All commands accept `0x...` addresses, ENS names (e.g. `vitalik.eth`), local wallet names, or watched addresses.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth (API key / x402 / MPP) see the `zerion` umbrella skill.

## When to use

- "What's in this wallet?" / portfolio value
- Token holdings, DeFi positions (lending, staking, LP, borrowed)
- Transaction history (parsed: trade, send, receive, mint, approve…)
- Profit & loss (realized, unrealized, fees)
- "What chains is this wallet active on?"
- Track an address over time (watchlist)

For execution (swap/bridge/send) → `zerion-trading`. For wallet creation → `zerion-wallet`.

## Full analysis (recommended starting point)

```bash
zerion analyze <address|name>
zerion analyze <address|name> --chain <chain>
zerion analyze <address|name> --positions all|simple|defi
zerion analyze <address|name> --limit <n>           # txs to sample (default 10)
zerion analyze <address|name> --x402                # pay-per-call
```

Fetches portfolio + positions + transactions + PnL in parallel. Returns a summary with portfolio total + chain breakdown + 1-day change, top 10 positions by value, 5 most recent transactions, and PnL totals.

## Targeted reads

```bash
# Portfolio value + top positions + 1-day change
zerion portfolio <address|name>
zerion portfolio --wallet <name>
zerion portfolio --watch <name>                     # use watched wallet by name

# Token + DeFi positions
zerion positions <address|name>
zerion positions <address|name> --positions all     # default: tokens + DeFi
zerion positions <address|name> --positions simple  # tokens only
zerion positions <address|name> --positions defi    # DeFi protocols only
zerion positions <address|name> --chain <chain>

# Transaction history
zerion history <address|name>
zerion history <address|name> --limit <n>           # default 10
zerion history <address|name> --chain <chain>

# Profit & loss
zerion pnl <address|name>
```

All accept `--x402` (or `--mpp`) for pay-per-call without an API key.

## Token search (find a contract address)

```bash
zerion search <query>                               # by name, symbol, or address
zerion search <query> --chain <chain>
zerion search <query> --limit <n>                   # default 10
```

## Watchlist (track addresses you don't own)

Adds an address to a local watchlist so analysis commands can refer to it by name (`--watch <name>`).

```bash
zerion watch <address|ens> --name <label>           # add (e.g. "vitalik.eth" --name vit)
zerion watch list                                   # list all watched
zerion watch remove <name>                          # remove

# Then use the watched name with any analysis command
zerion portfolio --watch vit
zerion analyze --watch vit
```

## Typical workflow

1. Run `zerion analyze <address>` for the broad picture.
2. Drill into specifics if needed:
   - DeFi-only: `zerion positions <address> --positions defi`
   - Single chain: `zerion positions <address> --chain ethereum` (or `--chain monad`)
   - More transactions: `zerion history <address> --limit 25`
3. For repeat monitoring, add to watchlist: `zerion watch <addr> --name <label>`.

## Output

JSON on stdout, structured errors on stderr. See the `zerion` umbrella skill for the error contract.

## Pay-per-call

`--x402` (Base / Solana) and `--mpp` (Tempo) work on every command in this skill. Trading commands do NOT support pay-per-call — always need an API key.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | No `ZERION_API_KEY` and no `--x402`/`--mpp` | Set the env var or pass the flag |
| `unsupported_chain` | Invalid `--chain` | `zerion chains` for valid IDs |
| `unsupported_positions_filter` | Invalid `--positions` | Use `all`, `simple`, or `defi` |
| `api_error` 429 | Rate limited | Wait, reduce frequency, or switch to `--x402` |
| `api_error` 400 | Invalid address or ENS resolution failure | Retry with the resolved 0x address |

Empty positions/history usually means the wallet is inactive or very new — not an error.
