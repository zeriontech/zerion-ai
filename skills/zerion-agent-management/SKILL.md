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
| `agent create-token` (default) | **Manual** | Interactive passphrase prompt. Humans run it. |
| `agent create-token --passphrase-file <path>` | **Agent-capable** | Reads passphrase from a `chmod 600` file. For CI / headless / scripted setup once the file is provisioned by a human or secrets manager. |
| `agent revoke-token`, `agent create-policy`, `agent delete-policy` | **Manual** | Require passphrase or confirmation. Humans must run these directly. |

## Read-only — agents may invoke freely

```bash
zerion agent list-tokens              # Tokens, attached policies, active flag, wallet binding
zerion agent list-policies            # All policies with rules summary
zerion agent show-policy <id>         # Full policy details
zerion agent use-token --wallet <wallet>   # Switch the active token (config edit, no passphrase)
```

## Token + policy management

The default flow is human-interactive. `agent create-token` also has a non-interactive variant (`--passphrase-file`) for automation once the passphrase file is provisioned. Everything else in this section requires a human.

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

### Non-interactive token creation (`--passphrase-file`)

`--passphrase-file <path>` takes a path to a **plain-text file whose entire contents are the wallet passphrase** (the same string a human would type at the TTY prompt). The CLI reads the file once and uses its contents to unlock the keystore. Nothing else lives in the file — no JSON, no key=value, no header.

For CI, headless servers, or scripted agent setup, write the passphrase to such a file instead of typing it:

```bash
# Write the passphrase to a file readable only by you
umask 077                                   # ensure new files default to 0600
printf '%s' "$ZERION_PASSPHRASE" > ~/.zerion-pass
chmod 600 ~/.zerion-pass                    # required — refused if looser

# Create the token non-interactively
zerion agent create-token \
  --name bot --wallet my-agent \
  --policy <id> \
  --passphrase-file ~/.zerion-pass

# Clean up immediately
shred -u ~/.zerion-pass 2>/dev/null || rm -f ~/.zerion-pass
```

For ephemeral storage (recommended on Linux), use a tmpfs mount instead of `$HOME`:

```bash
# Linux only — /run is tmpfs (RAM-only, gone on reboot)
sudo install -d -m 0700 -o "$USER" /run/zerion
printf '%s' "$ZERION_PASSPHRASE" > /run/zerion/pass && chmod 600 /run/zerion/pass
zerion agent create-token ... --passphrase-file /run/zerion/pass
```

On macOS, use `/private/tmp/<your-user>/...` or a per-app dir under `~/Library/Caches/`. macOS does not ship a user-writable `/run`.

#### File format

Plain UTF-8 text. The entire file (minus exactly one optional trailing `\n` or `\r\n`) is treated as the passphrase.

| Rule | Reason |
|---|---|
| Content = raw passphrase bytes only | No JSON, no `key=value`, no comments, no quotes. Anything in the file is part of the passphrase. |
| One trailing `\n` or `\r\n` stripped | So `echo "pass" > file` works as expected. Additional newlines are kept. |
| Leading / trailing spaces inside the passphrase are preserved | Passphrases may legitimately contain them. CLI does **not** `.trim()`. |
| UTF-8 encoded | Read via `readFileSync(path, "utf8")`. Non-UTF-8 bytes become replacement chars. |
| Non-empty | Empty file or newline-only file → rejected. |
| Mode `0600` (POSIX) | Refused otherwise — see Rules below. |
| Regular file, owned by current uid | Symlinks-to-files are followed; the target must still pass perm + ownership checks. |

Examples (file bytes → passphrase used by CLI):

| Command | File bytes | Passphrase result |
|---|---|---|
| `printf '%s' 'hunter2' > f` | `hunter2` | `hunter2` ✅ |
| `printf '%s\n' 'hunter2' > f` | `hunter2\n` | `hunter2` ✅ |
| `echo 'hunter2' > f` | `hunter2\n` | `hunter2` ✅ |
| `echo '"hunter2"' > f` | `"hunter2"\n` | `"hunter2"` (quotes included!) ❌ |
| `echo '  spaces  ' > f` | `  spaces  \n` | `  spaces  ` (spaces kept) ✅ |
| `printf '' > f` | (empty) | rejected ❌ |
| `printf '\n' > f` | `\n` | rejected ❌ |

Canonical form — no trailing newline, no surprises:

```bash
umask 077
printf '%s' 'YOUR-PASSPHRASE' > ~/.zerion-pass
chmod 600 ~/.zerion-pass
```

Verify before using:

```bash
wc -c ~/.zerion-pass     # byte count == passphrase length
xxd ~/.zerion-pass | head # eyeball raw bytes — no BOM, no quotes, no CRLF
```

#### Rules

- File **must be mode `0600`** (owner read/write only). Any group/other bits → CLI refuses with `passphrase_file_error`.
- File **must be owned by the current uid** (POSIX). Reading another user's file (e.g. via symlink) is refused. Matches SSH `IdentityFile` behavior.
- Trailing newline (`\n` or `\r\n`) is stripped; leading/trailing spaces inside the passphrase are preserved.
- Empty file is rejected.
- Permission and ownership checks are skipped on Windows (POSIX mode bits and uid not meaningful there) — use NTFS ACLs to restrict access instead.

Recommended patterns:

| Environment | Source | Notes |
|---|---|---|
| Local dev | `~/.zerion-pass` (chmod 600) | Delete after use. |
| Docker | Bind-mount a tmpfs file | `--tmpfs /run/zerion:mode=0700` then write passphrase inside. |
| Kubernetes | Mount a `Secret` as a file | Default mount mode is `0644` — set `defaultMode: 0600` in the volume spec. |
| GitHub Actions | Write `${{ secrets.X }}` to a temp file, `chmod 600`, then run | Cleanup is automatic at job end. |
| HashiCorp Vault | `vault agent` template renders to a 0600 file | Renew & rotate centrally. |

Threat model: same as an SSH private key on disk. Anyone with **active-session read access to the file** can unlock the keystore. Keep the file path off shared filesystems, out of git, out of process listings. Argv-passed passphrases (`--passphrase <value>`) are **not** supported because they leak to `ps aux`, shell history, and CI logs.

`--passphrase-file` only affects `agent create-token` for now. `wallet create`, `wallet import`, and other passphrase-gated commands still require an interactive TTY.

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
zerion agent create-policy --name monad-only --chains monad

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
| `passphrase_file_error` | `--passphrase-file` path missing, wrong perms, or empty | `chmod 600 <path>`; ensure file exists and is non-empty |
