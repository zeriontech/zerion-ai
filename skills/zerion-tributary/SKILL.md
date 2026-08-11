---
name: zerion-tributary
description: "Create and manage on-chain recurring subscriptions via Tributary protocol on Solana. Use when the user asks to set up recurring payments, subscriptions, pay-as-you-go policies, or view active payment policies. Requires a Zerion wallet with SOL and USDC on Solana. Pair with zerion-wallet for wallet setup and zerion-analyze for balance checks."
license: MIT
allowed-tools: Bash
---

# Zerion — Tributary Subscriptions

Create and manage on-chain recurring payments on Solana via the Tributary protocol.

## Setup

```bash
npm install -g zerion-cli
```

Requires Node.js >= 20. Wallet must have SOL for gas and USDC for payments on Solana.

## When to use

- "Set up a $10 monthly subscription to address X"
- "Create recurring payment"
- "Show my active subscriptions"
- "Pause/resume/delete my subscription"
- "List all payment policies"

## Commands

### Create subscription

```bash
zerion subscribe create <amount> <recipient> --interval <frequency> [flags]
```

- `amount` — human-readable USD amount (e.g., `10` = $10 USDC)
- `recipient` — Solana pubkey receiving payments
- `--interval` — required: `daily`, `weekly`, `monthly`, `quarterly`, `semi-annually`, `annually`
- `--token` — token mint address (default: USDC)
- `--gateway` — payment gateway PDA (default: Tributary gateway)
- `--no-auto-renew` — disable auto-renewal
- `--max-renewals` — cap number of renewals
- `--memo` — memo string attached to the policy
- `--wallet` — Zerion wallet name
- `--dry-run` — build tx but don't send

```bash
zerion subscribe create 10 2NsnnHp9SaLzo... --interval monthly --wallet bot
```

### List subscriptions

```bash
zerion subscribe list [flags]
```

- `--status` — filter: `active`, `paused`, `all` (default: `all`)
- `--pretty` — human-readable table output
- `--wallet` — Zerion wallet name

### Show single policy

```bash
zerion subscribe show <policy-id> [flags]
```

### Pause / Resume

```bash
zerion subscribe pause <policy-id> --token <mint> [--wallet <name>]
zerion subscribe resume <policy-id> --token <mint> [--wallet <name>]
```

### Delete

```bash
zerion subscribe delete <policy-id> --token <mint> [--wallet <name>]
```

## Prerequisites

1. A Zerion wallet with Solana account: `zerion wallet create --name bot`
2. Fund with SOL + USDC on Solana: `zerion wallet fund --wallet bot`
3. Agent token for signing: `zerion agent create-token --name bot-agent --wallet bot`

## Demo flow

```bash
zerion subscribe create 10 <recipient> --interval monthly --wallet bot
zerion subscribe list --wallet bot --pretty
zerion subscribe show 1 --wallet bot
zerion subscribe pause 1 --wallet bot
zerion subscribe resume 1 --wallet bot
```

## Error codes

| Code                 | Cause                                     |
| -------------------- | ----------------------------------------- |
| `missing_args`       | Required positional args or flags missing |
| `invalid_amount`     | Amount is not a positive number           |
| `invalid_interval`   | Unknown interval string                   |
| `invalid_policy_id`  | Policy ID not a positive integer          |
| `subscription_error` | SDK or on-chain error during create       |
| `list_error`         | Failed to fetch policies                  |
| `policy_not_found`   | Policy doesn't exist for this wallet      |
