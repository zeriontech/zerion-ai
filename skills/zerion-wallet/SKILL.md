---
name: zerion-wallet
description: "Manage local Zerion wallets via the Zerion CLI: create, import (private key or mnemonic), list, fund (deposit addresses), backup (recovery phrase), delete, and sync to the Zerion mobile app. Most commands require an interactive passphrase prompt — humans must run them directly. Use whenever the user asks to set up, manage, or back up a wallet."
license: MIT
allowed-tools: Bash
---

# Zerion — Wallet Management

Encrypted local wallets stored in the Open Wallet Standard (OWS) vault at `~/.ows/`, AES-256-GCM. Keys never leave the device.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the `zerion` umbrella skill.

## When to use

- "Create a new wallet"
- "Import my wallet from a private key / mnemonic"
- "Show my wallets" / "list deposit addresses"
- "Back up my recovery phrase"
- "Delete this wallet"
- "Sync my wallet to the Zerion mobile app"

For on-chain actions with a wallet → `zerion-trading`. For agent-token setup on a wallet → `zerion-agent-management`.

### Wallets and chains

A mnemonic-derived wallet (created via `wallet create` or `wallet import --mnemonic`) holds **both** an EVM and a Solana account, so the same wallet can sign on either chain and act as a destination for cross-chain bridges in either direction.

A wallet imported from a single private key holds only one chain's account:

| Import flag | Account type | Can swap on | Can be cross-chain destination for |
|-------------|--------------|-------------|-------------------------------------|
| `--mnemonic` | EVM + Solana | both | both |
| `--evm-key` | EVM only | EVM chains | EVM chains |
| `--sol-key` | Solana only | Solana | Solana |

`wallet list` shows which accounts each wallet has. Use this when picking `--to-wallet` for a cross-chain bridge — the destination wallet must have an account on the target chain.

## Agent vs manual operations

| Operation | Type | Notes |
|-----------|------|-------|
| `wallet list`, `wallet fund` | **Agent** | Read-only. Safe to invoke autonomously. |
| `wallet create`, `wallet import`, `wallet backup`, `wallet delete`, `wallet sync` | **Manual** | Require passphrase or interactive input. Humans must run these directly — agents must not call them. |

## Read-only — agents may invoke freely

```bash
zerion wallet list                        # All wallets, addresses, active policies
zerion wallet list --search <query>       # Filter by name or address
zerion wallet list --limit <n> --offset <n>   # Paginate
zerion wallet fund --wallet <name>        # Show EVM + Solana deposit addresses
```

## Manual — humans only

These prompt for a passphrase, secret key, or confirmation. **Do not invoke from an agent loop.**

```bash
# Create a fresh encrypted wallet (EVM + Solana, generated locally)
zerion wallet create --name <name>

# Import from existing keys (interactive secret prompts — never expose keys in shell history)
zerion wallet import --name <name> --evm-key
zerion wallet import --name <name> --sol-key
zerion wallet import --name <name> --mnemonic

# Export the recovery phrase (passphrase required)
zerion wallet backup --wallet <name>

# Permanently delete (passphrase + confirmation)
zerion wallet delete <name>

# Sync to the Zerion mobile app via a one-time QR code
zerion wallet sync --wallet <name>
zerion wallet sync --all
```

## Setting defaults

Wallet-related config is set with `zerion config`:

```bash
zerion config set defaultWallet <name>    # Used when --wallet is omitted
zerion config get defaultWallet
zerion config unset defaultWallet         # Resets to "no default"
zerion config list                        # Show all config (sensitive values redacted)
```

`~/.zerion/config.json` is created with mode 0o600.

## Typical setup flow (human runs these in order)

```bash
# 1. Create wallet (passphrase prompt; offers agent-token setup at the end)
zerion wallet create --name agent-bot

# 2. Fund it
zerion wallet fund --wallet agent-bot
# → prints EVM and Solana deposit addresses

# 3. Set as default so future commands omit --wallet
zerion config set defaultWallet agent-bot

# 4. (Optional) sync to mobile
zerion wallet sync --wallet agent-bot
```

After step 1's agent-token prompt, the wallet is ready for autonomous trading via `zerion-trading`. To configure agent tokens or policies later → `zerion-agent-management`.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `wallet_exists` | Wallet name already taken | Choose a different name or `wallet delete` first |
| `wallet_not_found` | Name not in OWS vault | `zerion wallet list` to see existing |
| `bad_passphrase` | Wrong passphrase entered | Retry; passphrase is set at creation |
| `bad_mnemonic` | Invalid recovery phrase format | Re-enter; must be valid BIP-39 |
| `bad_evm_key` | Invalid 0x-prefixed hex | Should be 64 hex chars after `0x` |
| `bad_sol_key` | Invalid base58 keypair | Solana keys are base58, ≥87 chars |
