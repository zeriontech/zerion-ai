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
- Creating or managing wallets
- Backing up or syncing wallets
- Setting up agent tokens for unattended trading
- Configuring security policies (chain locks, allowlists, expiry)

## Wallet management

### Create a wallet

```bash
zerion wallet create --name <name>
```

Creates an OWS-encrypted wallet with both EVM and Solana addresses.

### Import a wallet

```bash
zerion wallet import --name <name> --key        # interactive private key prompt
zerion wallet import --name <name> --mnemonic    # interactive mnemonic prompt

```

### List wallets

```bash
zerion wallet list
```

### Set default wallet

```bash
zerion config set defaultWallet <name>
```

## Trading

All trading commands require an agent token (see below). No passphrase prompts.

### Swap tokens

```bash
# Get a quote
zerion swap ETH USDC 0.1

# Execute the swap
zerion swap ETH USDC 0.1 --yes

# Cross-chain swap (swap + bridge)
zerion swap ETH USDC 0.1 --to-chain arbitrum --yes

# With timeout for slow bridges
zerion swap ETH USDC 0.1 --to-chain arbitrum --timeout 300 --yes
```

### Bridge tokens

```bash
# Bridge ETH to Arbitrum
zerion bridge ETH arbitrum 0.1 --yes

# Bridge + swap (bridge ETH to Arbitrum, receive USDC)
zerion bridge ETH arbitrum 0.1 --to-token USDC --yes
```

### Send / transfer tokens

```bash
# Send native token (ETH, BNB, etc.)
zerion send ETH 0.01 --to 0x... --chain base --yes

# Send ERC-20 token
zerion send USDC 10 --to 0x... --chain ethereum --yes
```

### Search tokens

```bash
zerion search PEPE
zerion search "uniswap" --chain ethereum
```

### List available swap tokens

```bash
zerion swap tokens ethereum
```

## Agent tokens (required for trading)

Agent tokens are required for all trading commands (swap, bridge, send). A security policy is always required — if `--policy` is omitted, an interactive picker guides you through:
1. **Tier** — Standard (deny transfers + expiry), Strict (+ chain restriction), or Custom
2. **Expiry** — 7 days, 30 days, or no expiry
3. **Chains** (Strict only) — checklist of allowed chains

```bash
# Create a token — interactive policy setup
zerion agent create-token --name my-bot --wallet test-bot

# Create with an existing policy (non-interactive)
zerion agent create-token --name my-bot --wallet test-bot --policy <policy-id>

# Or create wallet (includes token + policy setup at the end)
zerion wallet create --name my-bot

# List tokens
zerion agent list-tokens

# Revoke a token
zerion agent revoke-token --name my-bot
```

The token is read from config automatically. No environment variable needed.

## Security policies

Restrict what agent tokens can do:

```bash
# Chain lock — only allow trading on specific chains
zerion agent create-policy --name safe-trading --chains base,arbitrum

# Expiry — token expires after time period
zerion agent create-policy --name temp-access --expires 24h

# Deny raw transfers
zerion agent create-policy --name no-transfers --deny-transfers

# Deny ERC-20 approvals
zerion agent create-policy --name no-approvals --deny-approvals

# Allowlist — only interact with specific addresses
zerion agent create-policy --name dex-only --allowlist 0xRouter1,0xRouter2

# Combine multiple rules
zerion agent create-policy --name strict \
  --chains base --expires 7d --deny-transfers --deny-approvals

# List / show / delete policies
zerion agent list-policies
zerion agent show-policy <id>
zerion agent delete-policy <id>
```

## Watchlist and analysis

```bash
zerion watch 0xd8dA... --name vitalik
zerion watch list
zerion analyze vitalik
zerion watch remove vitalik
```

## Wallet backup & sync

```bash
zerion wallet backup --wallet test-bot   # Export recovery phrase (mnemonic)
zerion wallet sync --wallet test-bot     # QR code to sync with Zerion iOS app
zerion wallet sync --all                 # Sync all wallets
```

## Output modes

- `--json` — JSON output (default, agent-friendly)
- `--pretty` — Human-readable tables (auto-enabled for TTY)
- `--quiet` — Minimal output
- `--yes` — Skip confirmation prompts (required for trade execution)

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Best practices

1. **Always get a quote first** — run swap/bridge/send without `--yes` to see the quote
2. **Create an agent token** — required for all trading; `zerion agent create-token` saves it to config
3. **Apply security policies** — chain locks + allowlists prevent accidental trades
4. **Set defaults** — `config set defaultWallet` and `config set defaultChain` reduce flag typing
5. **Use `--timeout` for bridges** — cross-chain operations can be slow; default is 120s
