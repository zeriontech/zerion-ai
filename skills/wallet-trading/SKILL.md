---
name: wallet-trading
description: "Trade crypto tokens: swap, bridge across 14 chains. Manage wallets, agent tokens, and security policies."
compatibility: "Requires zerion-cli (`npx zerion-cli` or `npm install -g zerion-cli`). Set ZERION_API_KEY. Trading requires OWS wallet setup."
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

# Wallet Trading

Trade crypto tokens, manage wallets, and configure agent security policies using zerion-cli.

## Setup check

```bash
which zerion-cli || npm install -g zerion-cli
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
zerion-cli wallet create --name <name>
```

Creates an OWS-encrypted wallet with both EVM and Solana addresses.

### Import a wallet

```bash
zerion-cli wallet import --name <name> --key        # interactive private key prompt
zerion-cli wallet import --name <name> --mnemonic    # interactive mnemonic prompt
zerion-cli wallet import --name <name> --key-file <path>  # from file (safest)
```

### List wallets

```bash
zerion-cli wallet list
```

### Set default wallet

```bash
zerion-cli config set defaultWallet <name>
```

## Trading

### Swap tokens

```bash
# Get a quote
zerion-cli swap ETH USDC 0.1

# Execute the swap
zerion-cli swap ETH USDC 0.1 --yes

# Cross-chain swap (swap + bridge)
zerion-cli swap ETH USDC 0.1 --to-chain arbitrum --yes
```

### Bridge tokens

```bash
# Bridge ETH to Arbitrum
zerion-cli bridge ETH arbitrum 0.1 --yes

# Bridge + swap (bridge ETH to Arbitrum, receive USDC)
zerion-cli bridge ETH arbitrum 0.1 --to-token USDC --yes
```

### Search tokens

```bash
zerion-cli search PEPE
zerion-cli search "uniswap" --chain ethereum
```

### List available swap tokens

```bash
zerion-cli swap tokens ethereum
```

## Agent tokens (unattended trading)

Create scoped API tokens that bypass passphrase prompts:

```bash
# Create a token
zerion-cli agent create-token --name my-bot --wallet test-bot

# List tokens
zerion-cli agent list-tokens

# Revoke a token
zerion-cli agent revoke-token --name my-bot
```

Use agent tokens via environment variable:
```bash
export ZERION_AGENT_TOKEN=ows_key_...
zerion-cli swap ETH USDC 0.1 --yes  # no passphrase prompt
```

## Security policies

Restrict what agent tokens can do:

```bash
# Chain lock — only allow trading on specific chains
zerion-cli agent create-policy --name safe-trading --chains base,arbitrum

# Expiry — token expires after time period
zerion-cli agent create-policy --name temp-access --expires 24h

# Deny raw transfers
zerion-cli agent create-policy --name no-transfers --deny-transfers

# Deny ERC-20 approvals
zerion-cli agent create-policy --name no-approvals --deny-approvals

# Allowlist — only interact with specific addresses
zerion-cli agent create-policy --name dex-only --allowlist 0xRouter1,0xRouter2

# Combine multiple rules
zerion-cli agent create-policy --name strict \
  --chains base --expires 7d --deny-transfers --deny-approvals

# List / show / delete policies
zerion-cli agent list-policies
zerion-cli agent show-policy <id>
zerion-cli agent delete-policy <id>
```

## Watchlist and analysis

```bash
zerion-cli watch 0xd8dA... --name vitalik
zerion-cli watch list
zerion-cli analyze vitalik
zerion-cli watch remove vitalik
```

## Wallet backup & sync

```bash
zerion-cli wallet backup --wallet test-bot   # Export recovery phrase (mnemonic)
zerion-cli wallet sync --wallet test-bot     # QR code to sync with Zerion iOS app
zerion-cli wallet sync --all                 # Sync all wallets
```

## Output modes

- `--json` — JSON output (default, agent-friendly)
- `--pretty` — Human-readable tables (auto-enabled for TTY)
- `--quiet` — Minimal output
- `--yes` — Skip confirmation prompts (required for trade execution)

## Supported chains

ethereum, base, arbitrum, optimism, polygon, binance-smart-chain, avalanche, gnosis, scroll, linea, zksync-era, zora, blast, solana.

## Best practices

1. **Always get a quote first** — run swap/bridge without `--yes` to see the quote
2. **Use agent tokens for bots** — never expose your passphrase in scripts
3. **Apply security policies** — chain locks + allowlists prevent accidental trades
4. **Set defaults** — `config set defaultWallet` and `config set defaultChain` reduce flag typing
