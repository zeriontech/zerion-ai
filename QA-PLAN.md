# QA Plan: Agent Wallet Features

## Overview

This plan covers all wallet management, agent token/policy lifecycle, trading with agent tokens, and the security hardening added to passphrase handling.

**Pre-requisites:**
- `npm link` in the zerion-ai repo so `zerion-cli` is available globally
- A funded wallet on Base or Ethereum testnet (for trading tests)
- `ZERION_API_KEY` set in env or config

---

## 1. Wallet Create — Passphrase Enforcement

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 1.1 | Interactive passphrase prompt | `zerion-cli wallet create --name qa-1` | Prompts masked `Enter passphrase: ****` then `Confirm passphrase: ****`, creates wallet |
| 1.2 | Passphrase mismatch retries | Enter "abc123" then "xyz789" at confirm | `Passphrases do not match. Try again.` — re-prompts until match |
| 1.3 | Empty passphrase rejected | Press Enter at passphrase prompt | `Passphrase cannot be empty. Try again.` — re-prompts |
| 1.4 | `--passphrase` flag ignored | `zerion-cli wallet create --name qa-2 --passphrase test` | Still prompts interactively — flag has no effect |
| 1.5 | Non-TTY rejected | `echo "" \| zerion-cli wallet create --name qa-3` | Error: `Passphrase must be entered interactively (TTY required)` |
| 1.6 | Ctrl-C aborts cleanly | Press Ctrl-C during passphrase prompt | Exits code 130, no wallet created |
| 1.7 | Backspace in masked input | Type "abc", backspace, type "d" | Mask: `***` → `**` → `***`, passphrase = "abd" |
| 1.8 | Auto-generated name | `zerion-cli wallet create` (no --name) | Creates wallet named `wallet-N` |
| 1.9 | Duplicate name rejected | Create same name twice | Error: `wallet name already exists` |
| 1.10 | Sets default if first wallet | Create when no wallets exist | Output: `"isDefault": true` |

---

## 2. Wallet Import — Passphrase Enforcement

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 2.1 | Import key interactively | `zerion-cli wallet import --name qa-imp --key` | Prompts passphrase (masked + confirm), then prompts for key |
| 2.2 | Import mnemonic interactively | `zerion-cli wallet import --name qa-imp2 --mnemonic` | Prompts passphrase (masked + confirm), then prompts for mnemonic |
| 2.3 | Import from key file | `zerion-cli wallet import --name qa-imp3 --key-file ./key.txt` | Prompts passphrase, reads key from file |
| 2.4 | Import from mnemonic file | `zerion-cli wallet import --name qa-imp4 --mnemonic-file ./seed.txt` | Prompts passphrase, reads mnemonic from file |
| 2.5 | `--passphrase` flag ignored | `zerion-cli wallet import --name qa-5 --key --passphrase test` | Still prompts interactively |
| 2.6 | Non-TTY rejected | `echo "" \| zerion-cli wallet import --name qa-6 --key` | Error: TTY required |
| 2.7 | No key or mnemonic | `zerion-cli wallet import --name qa-7` | Error: `Provide --key, --key-file, --mnemonic, or --mnemonic-file` |
| 2.8 | Both key and mnemonic | `zerion-cli wallet import --key --mnemonic` | Error: `Provide either key or mnemonic, not both` |

---

## 3. Wallet Backup — Full Security Gate

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 3.1 | Backup with correct passphrase | `zerion-cli wallet backup qa-1` | Shows warning, prompts masked passphrase, displays mnemonic on stderr |
| 3.2 | Wrong passphrase rejected | Enter wrong passphrase at prompt | Error: `Failed to export wallet` |
| 3.3 | Mnemonic only on stderr | `zerion-cli wallet backup qa-1 2>/dev/null` | Nothing visible (mnemonic suppressed with stderr) |
| 3.4 | Mnemonic never on stdout | `zerion-cli wallet backup qa-1 > out.txt` (enter passphrase) | `out.txt` is empty — mnemonic only on stderr |
| 3.5 | Agent mode blocked | `ZERION_AGENT_TOKEN=x zerion-cli wallet backup qa-1` | Error: `wallet export is not available in agent mode` |
| 3.6 | Non-TTY blocked | `echo "pass" \| zerion-cli wallet backup qa-1` | Error: `wallet export requires an interactive terminal` |
| 3.7 | No wallet specified | `zerion-cli wallet backup` (no default set) | Error: `No wallet specified` |
| 3.8 | Unknown wallet name | `zerion-cli wallet backup nonexistent` | Error: `Failed to export wallet` |
| 3.9 | `--passphrase` flag ignored | `zerion-cli wallet backup qa-1 --passphrase test` | Still prompts interactively |
| 3.10 | Full pipe blocked | `zerion-cli wallet backup qa-1 > out.txt 2>&1` | Fails at TTY check — no output at all |

---

## 4. Wallet List — Pagination and Search

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 4.1 | Default list (max 20) | `zerion-cli wallet list` | Shows up to 20 wallets, `"hasMore": true` if > 20 |
| 4.2 | Custom limit | `zerion-cli wallet list --limit 5` | Shows exactly 5 wallets |
| 4.3 | Offset pagination | `zerion-cli wallet list --limit 5 --offset 5` | Shows wallets 6–10 |
| 4.4 | Search by name | `zerion-cli wallet list --search bot` | Only wallets with "bot" in name |
| 4.5 | Search by address | `zerion-cli wallet list --search 0x5B20` | Only wallets matching address fragment |
| 4.6 | Search no results | `zerion-cli wallet list --search zzzzz` | `"total": 0, "wallets": []` |
| 4.7 | Pretty mode shows "more" hint | `zerion-cli wallet list --limit 2 --pretty` | Shows `Use --offset 2 to see more` |
| 4.8 | JSON includes metadata | `zerion-cli wallet list --limit 5 --json` | JSON has `total`, `count`, `offset`, `limit`, `hasMore` |
| 4.9 | Filter alias works | `zerion-cli wallet list --filter bot` | Same as `--search bot` |

---

## 5. Agent Token Lifecycle

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 5.1 | Create token | `zerion-cli agent create-token --name bot-1 --wallet qa-1` | Returns token (shown once), warning to save |
| 5.2 | Create with policy | Create policy first, then `--policy <id>` | Token created with policy attached |
| 5.3 | Create with expiry | `--expires 24h` | Token has `expiresAt` set to ~24h from now |
| 5.4 | Create with multiple policies | `--policy id1,id2` | Both policy IDs attached |
| 5.5 | Invalid policy ID | `--policy nonexistent` | Error: policy not found |
| 5.6 | No name provided | `zerion-cli agent create-token --wallet qa-1` | Error: name required |
| 5.7 | List tokens | `zerion-cli agent list-tokens` | Shows all tokens with ids, names, wallet bindings |
| 5.8 | Revoke by name | `zerion-cli agent revoke-token --name bot-1` | Token revoked |
| 5.9 | Revoke by ID | `zerion-cli agent revoke-token --id <id>` | Token revoked |
| 5.10 | Revoke nonexistent | `zerion-cli agent revoke-token --name fake` | Error: `Agent token "fake" not found` |
| 5.11 | Token shown only once | Create token, then list tokens | List does NOT show the token secret |

---

## 6. Agent Policy Lifecycle

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 6.1 | Create chain-lock policy | `--name base-only --chains base` | Policy with `allowed_chains` rule (CAIP-2 format) |
| 6.2 | Create multi-chain policy | `--name multi --chains base,arbitrum,optimism` | All 3 chains in rule |
| 6.3 | Create with expiry | `--name temp --expires 7d` | Policy has `expires_at` rule |
| 6.4 | Create deny-transfers | `--name no-xfer --deny-transfers` | Policy with executable deny-transfers |
| 6.5 | Create deny-approvals | `--name no-approve --deny-approvals` | Policy with executable deny-approvals |
| 6.6 | Create allowlist | `--name whitelist --allowlist 0xabc,0xdef` | Policy with allowlist addresses |
| 6.7 | Combined rules | `--name strict --chains base --deny-transfers --allowlist 0xabc` | All rules combined |
| 6.8 | Invalid chain name | `--chains fakechain` | Error: unsupported chain |
| 6.9 | No rules provided | `--name empty` | Error: at least one rule required |
| 6.10 | List policies | `zerion-cli agent list-policies` | Shows all policies with formatted rules |
| 6.11 | Show policy detail | `zerion-cli agent show-policy --id <id>` | Full JSON with rules, config, version |
| 6.12 | Delete policy | `zerion-cli agent delete-policy --id <id>` | Policy removed |
| 6.13 | Delete nonexistent | `zerion-cli agent delete-policy --id fake` | Error |

---

## 7. Agent Trading (Token-Authenticated)

| # | Test Case | Command / Steps | Expected Result |
|---|-----------|----------------|-----------------|
| 7.1 | Swap quote (no execute) | `zerion-cli swap ETH USDC 0.01 --chain base` | Shows quote, no execution |
| 7.2 | Swap with agent token | `ZERION_AGENT_TOKEN=<token> zerion-cli swap ETH USDC 0.01 --chain base --yes` | Signs and broadcasts via agent token |
| 7.3 | Bridge with agent token | `ZERION_AGENT_TOKEN=<token> zerion-cli bridge ETH base 0.01 --yes` | Executes bridge |
| 7.6 | Policy blocks wrong chain | Token bound to base-only policy, swap on ethereum | Blocked by policy |
| 7.7 | Expired token rejected | Use token past expiry | Error: token expired/invalid |
| 7.8 | Revoked token rejected | Use a revoked token | Error: invalid token |
| 7.9 | Insufficient balance | Swap more than wallet holds | Error: insufficient balance |
| 7.10 | Cross-chain swap | `zerion-cli swap ETH USDC 0.01 --chain ethereum --to-chain base --yes` | Executes cross-chain |

---

## 8. Masked Input (`readSecret` / `readPassphrase`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 8.1 | Characters masked | Type passphrase in terminal | Each character shows `*` on stderr |
| 8.2 | Backspace removes character | Type "abc", press backspace | Display: `***` → `**`, passphrase = "ab" |
| 8.3 | Ctrl-C exits | Press Ctrl-C mid-input | Exit code 130, no side effects |
| 8.4 | Enter submits | Type passphrase, press Enter | Input accepted, newline printed |
| 8.5 | Long passphrase | Enter 100+ character passphrase | Works correctly for create and export |
| 8.6 | Special characters | Passphrase with `!@#$%^&*()` | Accepted and works for export roundtrip |
| 8.7 | Unicode passphrase | Passphrase with emoji or CJK chars | Accepted (or explicitly rejected with clear error) |

---

## 9. End-to-End Workflows

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 9.1 | Full agent setup | 1. `wallet create --name agent-bot` (enter passphrase) | All steps succeed |
|   |                  | 2. `agent create-policy --name base-only --chains base` | Policy created |
|   |                  | 3. `agent create-token --name bot-token --wallet agent-bot --policy <id>` | Token returned |
|   |                  | 4. `ZERION_AGENT_TOKEN=<token> zerion-cli swap ETH USDC 0.01 --chain base --yes` | Trade executes |
| 9.2 | Passphrase roundtrip | Create wallet with passphrase "MyPass!23", then export with same | Mnemonic displayed |
| 9.3 | Wrong passphrase on export | Create with "X", export with "Y" | Export fails |
| 9.4 | Agent can't backup | Set `ZERION_AGENT_TOKEN`, attempt `wallet backup` | Blocked with `agent_blocked` |
| 9.5 | Script can't extract seed | `zerion-cli wallet backup qa-1 > captured.txt 2>&1` | Fails at TTY check — nothing captured |
| 9.6 | Wallet list pagination | Create 25 wallets, list with default, then with offset | First call: 20 wallets + `hasMore`, second: remaining 5 |
| 9.7 | Wallet list search | Create wallets "bot-1", "bot-2", "personal" | `--search bot` returns only bot-1 and bot-2 |
| 9.8 | Token revoke stops trading | Create token, trade (success), revoke, trade again | Second trade fails |
| 9.9 | Policy delete + token | Create policy, attach to token, delete policy | Token still exists but policy no longer enforced |

---

## 10. Security Regression Checks

These tests verify the security hardening is not accidentally removed in future changes.

| # | Test Case | What to verify |
|---|-----------|---------------|
| 10.1 | No passphrase in process args | Run `ps aux \| grep zerion` during wallet create | Passphrase never appears in process list |
| 10.2 | No mnemonic on stdout | `zerion-cli wallet backup qa-1 \| cat` | Pipe fails (TTY check) — cat receives nothing |
| 10.3 | Config file permissions | `ls -la ~/.zerion-cli/config.json` | Permissions are `600` (owner read/write only) |
| 10.4 | API key masked in config list | `zerion-cli config list` | API key shows first 10 chars + "..." |
| 10.5 | Agent token shown once only | Create token, then `agent list-tokens` | List shows id/name but NOT the token secret |
| 10.6 | OWS never returns raw keys | Inspect `ows.listWallets()` output | No `privateKey` or `mnemonic` field in wallet objects |

---

## Test Execution Notes

**Manual tests (require real TTY):** 1.1–1.7, 2.1–2.2, 3.1–3.2, 8.1–8.7, 9.2–9.3

**Automatable tests (can run in CI with piped stdin):** 1.5, 1.9, 2.6–2.8, 3.5–3.8, 3.10, 4.1–4.9, 5.1–5.11, 6.1–6.13, 10.3–10.6

**Require funded wallet:** 7.1–7.10, 9.1

**Destructive / one-time:** 9.8 (revoke), 9.9 (delete policy)
