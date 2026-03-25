---
name: chains
description: "List blockchain networks supported by Zerion. Use when validating chain names, checking supported networks, or looking up chain metadata before querying wallet data."
compatibility: "Requires zerion-cli (`npx zerion-cli` or `npm install -g zerion-cli`). Set ZERION_API_KEY or use --x402 for pay-per-call."
license: MIT
allowed-tools: Bash
metadata:
  openclaw:
    requires:
      bins:
        - zerion-cli
    install:
      - kind: node
        package: "zerion-cli"
        bins: [zerion-cli]
    homepage: https://github.com/zeriontech/zerion-ai
---

# Chains

List supported blockchain networks using zerion-cli.

## Setup check

```bash
which zerion-cli || npm install -g zerion-cli
```

## Command

```bash
zerion-cli chains list [--x402]
```

Returns the full list of supported chains with IDs and metadata.

## When to use

- User asks "what chains does Zerion support?"
- You need to validate a chain ID before passing `--chain` to wallet commands
- Looking up chain metadata (name, type, support level)

## Quick reference (common chain IDs)

These chain IDs work with `--chain` in wallet commands:

| Chain | ID |
|-------|----|
| Ethereum | `ethereum` |
| Base | `base` |
| Arbitrum | `arbitrum` |
| Optimism | `optimism` |
| Polygon | `polygon` |
| BNB Chain | `bsc` |
| Avalanche | `avalanche` |
| Gnosis | `gnosis` |
| Scroll | `scroll` |
| Linea | `linea` |
| zkSync | `zksync` |
| Solana | `solana` |
| Zora | `zora` |
| Blast | `blast` |

50+ chains are supported in total. Run `zerion-cli chains list` for the complete list.

## Using with wallet commands

```bash
# Positions on a specific chain
zerion-cli wallet positions <address> --chain ethereum

# Transactions on a specific chain
zerion-cli wallet transactions <address> --chain base

# Full analysis filtered to one chain
zerion-cli wallet analyze <address> --chain arbitrum
```
