---
name: chains
description: "List blockchain networks supported by Zerion. Use when validating chain names, checking supported networks, or looking up chain metadata before querying wallet data."
compatibility: "Requires zerion (`npx zerion` or `npm install -g zerion`). Set ZERION_API_KEY or use --x402 for pay-per-call."
license: MIT
allowed-tools: Bash
metadata:
  openclaw:
    requires:
      bins:
        - zerion
    install:
      - kind: node
        package: "zerion"
        bins: [zerion]
    homepage: https://github.com/zeriontech/zerion-ai
---

# Chains

List supported blockchain networks using zerion.

## Setup check

```bash
which zerion || npm install -g zerion
```

## Command

```bash
zerion chains [--x402]
```

Returns the full chain catalog with IDs and metadata.

## When to use

- User asks "what chains does Zerion support?"
- You need the current chain catalog before choosing a `--chain` value
- Looking up chain metadata (name, type, support level)

## Quick reference (common chain IDs)

These are the chain IDs currently accepted by the wallet commands in this repo:

| Chain | ID |
|-------|----|
| Ethereum | `ethereum` |
| Base | `base` |
| Arbitrum | `arbitrum` |
| Optimism | `optimism` |
| Polygon | `polygon` |
| BNB Chain | `binance-smart-chain` |
| Avalanche | `avalanche` |
| Gnosis | `gnosis` |
| Scroll | `scroll` |
| Linea | `linea` |
| zkSync | `zksync-era` |
| Solana | `solana` |
| Zora | `zora` |
| Blast | `blast` |

`zerion chains` may return a broader catalog. For `positions`, `history`, and `analyze`, use the IDs above unless the CLI validator is expanded.

## Using with analysis commands

```bash
# Positions on a specific chain
zerion positions <address> --chain ethereum

# Transactions on a specific chain
zerion history <address> --chain base

# Full analysis filtered to one chain
zerion analyze <address> --chain arbitrum
```
