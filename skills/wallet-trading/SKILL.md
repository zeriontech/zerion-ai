---
name: wallet-trading
description: "Trade crypto tokens: swap, bridge across 14 chains. Manage wallets, agent tokens, and security policies."
compatibility: "Requires zerion (`npx zerion` or `npm install -g zerion`). Set ZERION_API_KEY. Trading requires OWS wallet setup."
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

# Wallet Trading

Trade crypto tokens, manage wallets, and configure agent security policies using zerion.

## Setup check

```bash
which zerion || npm install -g zerion
```

## Authentication

```bash
export ZERION_API_KEY="zk_dev_..."
```

Get yours at [dashboard.zerion.io](https://dashboard.zerion.io).

## When to use

Use this skill when the user asks about:
- Swapping or trading tokens
- Bridging tokens across chains
- Checking wallet balances before trading
- Searching for tokens or listing available swap pairs

For wallet creation, agent token setup, and policy configuration, tell the user to run those commands manually — they require interactive passphrase input.

## Agent operations — use these freely

All commands below are fully automated. No passphrase or interactive input needed.

### Check wallets & policies before trading

```bash
zerion wallet list                       # Shows wallets, active policies, and addresses
zerion agent list-tokens                 # Shows tokens with attached policies
zerion agent list-policies               # List all policies with rules summary
```

### Swap tokens

```bash
zerion swap ETH USDC 0.1
zerion swap ETH USDC 0.1 --chain base                    # Specify chain
zerion swap ETH USDC 0.1 --to-chain arbitrum              # Cross-chain swap
zerion swap ETH USDC 0.1 --to-chain arbitrum --timeout 300  # Slow bridge timeout
zerion swap ETH USDC 0.1 --slippage 1                     # Custom slippage
zerion swap ETH USDC 0.1 --wallet <name>                  # Use specific wallet
```

### Bridge tokens

```bash
zerion bridge ETH arbitrum 0.1 --from-chain base
zerion bridge ETH arbitrum 0.1 --from-chain base --to-token USDC  # Bridge + swap
```

### Send / transfer tokens

```bash
zerion send ETH 0.01 --to 0x... --chain base
zerion send USDC 10 --to 0x... --chain ethereum
```

### Search & discover

```bash
zerion search PEPE
zerion search "uniswap" --chain ethereum
zerion swap tokens ethereum               # List swap-available tokens
zerion chains                             # List supported chains
```

### Watchlist & analysis

```bash
zerion watch list                         # List watched wallets
zerion analyze <name|address>             # Analyze wallet trading activity
zerion analyze <name|address> --period 7d
```

## Off-chain signing — messages & typed data

For SIWE login, EIP-2612 `permit`, Permit2 approvals, Seaport orders. Unattended when an agent token is active, interactive otherwise.

```bash
zerion sign-message "hello" --chain ethereum               # EIP-191 personal_sign
zerion sign-message 0xdeadbeef --encoding hex              # Raw hex bytes
zerion sign-message "hi" --chain solana                    # Raw ed25519 (Solana)
zerion sign-typed-data --data '<json>' --chain base        # EIP-712 (EVM only)
zerion sign-typed-data --file permit.json                  # From file
cat permit.json | zerion sign-typed-data                   # From stdin
```

Security: signing arbitrary messages or typed data can authorize unlimited token allowances. Only sign payloads whose domain and primaryType you recognize.

## Manual operations — human must run these

These commands require passphrase, confirmation, or interactive input. Agents should tell the user to run them directly.

### Wallet setup

```bash
zerion wallet create --name <name>                        # Requires passphrase
zerion wallet import --name <name> --evm-key              # Interactive key input
zerion wallet import --name <name> --sol-key              # Interactive key input
zerion wallet import --name <name> --mnemonic             # Interactive mnemonic prompt
zerion wallet backup --wallet <name>                      # Requires passphrase
zerion wallet delete <name>                               # Requires passphrase + confirmation
zerion wallet sync --wallet <name>                        # Interactive QR code flow
```

### Agent token & policy creation

```bash
zerion agent create-token --name <bot> --wallet <wallet>  # Requires passphrase + policy picker
zerion agent create-policy --name <policy> --chains base,arbitrum --deny-transfers --expires 7d
zerion agent revoke-token --name <bot>
zerion agent delete-policy <id>
```

### Config changes

```bash
zerion config set defaultWallet <name>
zerion config set defaultChain <chain>
zerion config set slippage <percent>
```

## Output modes

- `--json` — JSON output (default, agent-friendly)
- `--pretty` — Human-readable tables (auto-enabled for TTY)
- `--quiet` — Minimal output

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Best practices

1. **Create an agent token** — required for all trading; `zerion agent create-token` saves it to config
3. **Apply security policies** — chain locks + allowlists prevent accidental trades
4. **Set defaults** — `config set defaultWallet` and `config set defaultChain` reduce flag typing
5. **Use `--timeout` for bridges** — cross-chain operations can be slow; default is 120s
