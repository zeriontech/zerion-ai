---
name: zerion-agent-management
description: "Manage Zerion agent tokens and security policies — the primitives for autonomous trading and signing. Create / list / use / revoke agent tokens; create / list / show / delete policies (chain locks, allowlists, transfer/approval gates, expiry). Use whenever the user asks to set up an agent token, configure a policy, or enable autonomous trading. Required by `zerion-trading` and `zerion-sign`."
license: MIT
allowed-tools: Bash
---

# Zerion — Agent Token & Policy Management

Agent tokens authorize the CLI to sign transactions on behalf of a wallet **without a passphrase prompt**. Policies attached to a token scope what the token can do (chains, allowlist, deny rules, expiry). This is the foundation for safe autonomous trading and off-chain signing.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the `zerion` umbrella skill. To execute trades after setup → `zerion-trading`. To sign messages/typed-data → `zerion-sign`.

## When to use

- "Create an agent token"
- "Set up autonomous trading"
- "Restrict the bot to chain X / address Y"
- "Block transfers" / "block approvals" / "expire the token in N days"
- "Switch which agent token is active"
- "Revoke a token"

## Agent vs manual operations

| Operation | Type | Notes |
|-----------|------|-------|
| `agent list-tokens`, `agent list-policies`, `agent show-policy`, `agent use-token` | **Agent** | Read-only or config-only. Safe autonomously. |
| `agent create-token`, `agent revoke-token`, `agent create-policy`, `agent delete-policy` | **Manual** | Require passphrase or confirmation. Humans must run these directly. |

## Read-only — agents may invoke freely

```bash
zerion agent list-tokens              # Tokens, attached policies, active flag, wallet binding
zerion agent list-policies            # All policies with rules summary
zerion agent show-policy <id>         # Full policy details
zerion agent use-token --wallet <wallet>   # Switch the active token (config edit, no passphrase)
```

## Manual — humans only

### Create an agent token

```bash
# Interactive policy picker (recommended)
zerion agent create-token --name <bot> --wallet <wallet>

# Attach an existing policy by ID
zerion agent create-token --name <bot> --wallet <wallet> --policy <id>

# Multiple policies (AND semantics — all must pass)
zerion agent create-token --name <bot> --wallet <wallet> --policy <id1>,<id2>
```

The token is auto-saved to `~/.zerion/config.json` under `agentTokens` and (if no token was active before) becomes the default. Trading commands (`zerion-trading`) and signing commands (`zerion-sign`) read it from config.

### Revoke a token

```bash
zerion agent revoke-token --name <bot>
zerion agent revoke-token --id <id>
```

### Create a policy

A policy is a set of rules a token must pass before signing. **At least one rule required.**

```bash
# Chain lock — restrict to specific chains
zerion agent create-policy --name safe-base --chains base,arbitrum

# Expiry — token deactivates after duration (e.g. 24h, 7d)
zerion agent create-policy --name short-lived --expires 7d

# Block raw native transfers (ETH/SOL send command)
zerion agent create-policy --name no-transfers --deny-transfers

# Block ERC-20 approvals (prevents allowance grants)
zerion agent create-policy --name no-approvals --deny-approvals

# Allowlist — only allow interaction with specific contract addresses
zerion agent create-policy --name dex-only --allowlist 0xUniRouter,0xCowSwap

# Combined rules (AND semantics)
zerion agent create-policy --name strict \
  --chains base \
  --expires 7d \
  --deny-transfers \
  --deny-approvals
```

### Delete a policy

```bash
zerion agent delete-policy <id>
```

Tokens that referenced the deleted policy will no longer pass that rule check.

## Policy reference

| Flag | Effect |
|------|--------|
| `--chains <list>` | Restrict to listed chains (comma-separated) |
| `--expires <duration>` | Token deactivates after duration. Format: `<n>h`, `<n>d` (e.g. `24h`, `7d`) |
| `--deny-transfers` | Block raw native transfers (`zerion send` of native asset) |
| `--deny-approvals` | Block ERC-20 `approve` calls |
| `--allowlist <addrs>` | Only allow interaction with listed contract addresses (comma-separated) |

Policies execute as locally-spawned scripts (`policies/*.mjs` in the CLI repo). They run on every signing attempt before the transaction is built.

## Recommended setup pattern

```bash
# 1. Create wallet (manual — see zerion-wallet skill)
zerion wallet create --name agent-bot

# 2. Create a tight policy
zerion agent create-policy --name swap-only \
  --chains base,arbitrum \
  --expires 30d \
  --deny-transfers \
  --allowlist 0xUniswapRouter,0x1inchRouter

# 3. Create the agent token bound to that policy
zerion agent create-token --name agent-bot \
  --wallet agent-bot \
  --policy <swap-only-id>

# Now zerion-trading and zerion-sign work autonomously
```

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `no_agent_token` | No active token for wallet | `agent create-token --wallet <wallet>` |
| `agent_token_expired` | Policy `--expires` lapsed | Create a fresh token |
| `policy_denied` | Action blocked by policy | `agent show-policy <id>` to see rules; revise or use a different token |
| `policy_not_found` | Policy ID doesn't exist | `agent list-policies` to find valid IDs |
| `policy_no_rules` | `create-policy` with no flags | Add at least one rule (`--chains`, `--expires`, `--deny-*`, `--allowlist`) |
| `token_name_exists` | Duplicate `--name` | Choose another name or `agent revoke-token --name <bot>` first |
