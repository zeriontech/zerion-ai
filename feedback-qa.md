# QA Report: Agent-Driven Wallet & Trading Flows

> Chronological log of agent testing against Zerion CLI.
> Each step documents what was tried, what broke, and what we learned.

---

## Step 1: Wallet Import via Codex — FAILED

**Date:** 2026-03-31
**Agent:** OpenAI Codex
**Command:**
```bash
zerion wallet import --name "Test Wallet" --key "$WALLET_PRIVATE_KEY"
```

### What happened

The CLI requires an interactive passphrase with confirmation (`Enter passphrase:` → `Confirm passphrase:`). Codex attempted to provide the passphrase programmatically through the terminal session.

Multiple approaches failed:
- sending the passphrase twice in one write
- sending the passphrase in separate writes
- sending extra newlines to advance the prompt
- waiting for the next visible prompt before sending more input

Every attempt ended with `"Passphrases do not match. Try again."` — the agent could not synchronize with the TTY prompt lifecycle.

### Outcome

The user had to run the command manually. Codex could not complete the interactive passphrase flow.

---

## Step 2: Wallet Import via Claude Code — SUCCESS (after debugging)

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)

### Problem

Same as Step 1 — the passphrase prompt uses Node.js raw mode (`process.stdin.setRawMode(true)`) with a hard TTY check:
```js
if (!process.stdin.isTTY) {
  throw new Error("Passphrase must be entered interactively (TTY required)");
}
```

Agent shell sessions don't provide a real TTY, so the CLI blocks before any input is possible.

### Attempt 1: `expect` with bulk send — FAILED

Used `expect` (pseudo-TTY emulator) to fake a TTY, sending the passphrase as a single string:
```expect
send "Andrei\r"
```
Raw mode only captured 2 out of 6 characters. Process hung indefinitely. Had to `pkill`.

### Attempt 2: `expect` with per-character sends — SUCCESS

Sent each character individually with inter-keystroke delays:
```expect
expect "Enter passphrase: "
sleep 0.5
send -- "A"
sleep 0.1
send -- "n"
sleep 0.1
send -- "d"
sleep 0.1
send -- "r"
sleep 0.1
send -- "e"
sleep 0.1
send -- "i"
sleep 0.3
send -- "\r"
```

Wallet imported successfully: `0xc3f353e9C5ED4a21e9B772d29500a5D1fAc2E0D6`.

### Assessment

This is **not an acceptable workflow**:
- required knowledge of `expect`, pseudo-TTY internals, and Node.js raw mode
- took multiple failed attempts and manual debugging
- relies on fragile timing (inter-keystroke delays of 100-500ms)
- exposed the private key in process args (visible in `expect` output / `ps`)

---

## Step 3: Cross-Chain Bridge via Agent — FAILED

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)
**Command:**
```bash
zerion swap BNB ETH 0.0042 --chain binance-smart-chain --to-chain base --yes
```

### What happened

Quote returned successfully (0.0042 BNB → ~0.00114 ETH, route: Relay, est. 4s). Passphrase accepted via `expect` on the first try.

But then the process **hung silently for 6+ minutes**. No output, no error, no progress indicator. Killed manually. Likely stuck at the `broadcastAndWait` step or bridge relay confirmation.

### Assessment

Cross-chain bridging is unreliable from an agent context. The CLI has no timeout and no progress output for long-running bridge operations — the agent can't tell if it's working or dead.

---

## Step 4: Same-Chain Swap via Agent — SUCCESS

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)
**Command:**
```bash
zerion swap ETH USDC 0.0005 --chain base --yes
```

### What happened

Passphrase accepted via `expect`. Swap executed cleanly in under 30 seconds.

| | |
|---|---|
| Input | 0.0005 ETH |
| Output | ~1.07 USDC |
| Source | KyberSwap |
| Tx | `0xee302f806fab0e52462f43666bc105892946d1c9288d0165d3c0d2b88467a2a5` |
| Block | 44146954 |
| Gas | 552,003 |

### Assessment

Same-chain swaps work well. JSON output is clean and parseable. But the `expect` passphrase hack was still required — same fragile workaround as wallet import.

---

## Step 5: Discovery — ZERION_AGENT_TOKEN exists

**Date:** 2026-04-01

After struggling with passphrase on every operation, the agent investigated the codebase and discovered that `ZERION_AGENT_TOKEN` already solves this problem for trading commands:

```js
// cli/commands/trading/swap.js:81-82
const agentToken = getAgentToken();                      // reads from env
const passphrase = agentToken || await readPassphrase();  // token OR passphrase
```

**How it works:**
1. Create a token once: `zerion agent create-token --name "bot" --wallet Test-Agent-Wallet`
2. Export it: `export ZERION_AGENT_TOKEN=ows_key_...`
3. All subsequent swap/bridge commands skip the passphrase prompt entirely

**The problem:** this token must be created interactively (requires passphrase to prove wallet ownership). And it's not mentioned anywhere in the wallet setup flow. The agent only found it by reading the swap source code after hitting the passphrase wall three times.

---

## Step 6: Agent Token Created — Passphrase Problem Solved

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)

Created an agent token via `expect` (last time passphrase was needed):
```bash
zerion agent create-token --name "claude-bot" --wallet Test-Agent-Wallet
```

Token created successfully. Added `ZERION_AGENT_TOKEN` to `.env`. Verified that swap quote works **without `expect`** — just a normal shell command:
```bash
export ZERION_AGENT_TOKEN=ows_key_...
zerion swap USDC ETH 2.69 --chain ethereum  # no passphrase prompt
```

### Assessment

This is the correct agent workflow. One-time `expect` pain during token creation, then all trading is frictionless. But the token creation itself still needs `--passphrase-file` to be fully automatable.

---

## Step 7: Cross-Chain Bridge Retry with Agent Token — FAILED AGAIN

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)
**Command:**
```bash
zerion swap BNB ETH 0.0042 --chain binance-smart-chain --to-chain base --wallet Test-Agent-Wallet --yes
```

### What happened

This time the agent token was used — **no passphrase prompt at all**. The quote returned normally (0.0042 BNB → ~0.00115 ETH, Relay, 4s). But the execution **hung silently again**, just like Step 3.

The process ran for 60+ seconds with zero output. No progress, no error, no timeout. Killed manually.

This confirms: **the cross-chain bridge hang is not a passphrase issue.** It's a problem in the execution pipeline itself — likely in `broadcastAndWait` or the Relay bridge provider integration. The code at `cli/lib/trading/transaction.js:87` has a 2-minute timeout for `waitForTransactionReceipt`, but the hang appears to happen before that — possibly at `sendRawTransaction` or during quote-to-execution transition.

### Assessment

Cross-chain bridge is broken for agents regardless of auth method. Same-chain swaps work fine. The bridge needs debugging independently of the passphrase/token flow.

---

## Step 8: Send/Transfer — NOT IMPLEMENTED

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)

### What happened

Agent was asked to send a small amount of BNB to the wallet's own address as a basic transfer test. Checked CLI help and router — **there is no `send` or `transfer` command**. Confirmed by searching the codebase: no `cli/commands/**/send*.js` file exists.

The CLI supports `swap`, `bridge`, and `search` under trading, but has no way to do a simple native token or ERC-20 transfer to an arbitrary address.

### Assessment

`send` is a fundamental wallet operation — arguably more basic than swap. Its absence means:

- Agents cannot move funds between wallets
- No way to withdraw to an external address
- No way to consolidate tokens across own wallets
- Testing is limited to swap loops instead of simple transfers

This is a gap in the CLI's coverage as a wallet management tool.

---

## Results Summary

| Step | Command | Auth Method | Result |
|------|---------|-------------|--------|
| 1 | `wallet import` (Codex) | Direct stdin | FAILED |
| 2 | `wallet import` (Claude) | `expect` per-char, 2 attempts | SUCCESS |
| 3 | `swap` cross-chain BSC→Base | `expect` per-char | HUNG — killed |
| 4 | `swap` same-chain Base | `expect` per-char | SUCCESS |
| 5 | Discovered `ZERION_AGENT_TOKEN` | N/A | — |
| 6 | Created agent token | `expect` per-char | SUCCESS |
| 7 | `swap` cross-chain BSC→Base | Agent token (no passphrase) | HUNG — killed |
| 8 | `send` BNB to self | N/A | NOT IMPLEMENTED |
| 9 | `bridge` vs `swap --to-chain` | Code review | Same pipeline |
| 10 | `wallet analyze` | No auth needed | SUCCESS |
| 11 | Position-level PnL | N/A | NOT AVAILABLE IN CLI |
| 12 | `search` for token (HYPE) | No auth needed | SUCCESS |

---

## Step 9: Bridge Command Investigation — Same Code Path

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)

### What happened

Before retrying cross-chain, the agent checked whether `bridge` (dedicated command) uses a different pipeline than `swap --to-chain`. Answer: **no**.

`cli/commands/trading/bridge.js:1` imports directly from the swap module:
```js
import { getSwapQuote, executeSwap } from "../../lib/trading/swap.js";
```

Both commands call the identical `getSwapQuote()` → `executeSwap()` → `signSwapTransaction()` → `broadcastAndWait()` chain. The `bridge` command is purely a CLI alias with friendlier argument order — there is no separate bridge execution path.

This means the cross-chain hang from Steps 3 and 7 would reproduce with `bridge` too. The bug is in the shared execution pipeline, not in how the command is invoked.

---

## Step 10: Wallet Analyze — SUCCESS

**Date:** 2026-04-01
**Agent:** Claude Code (Opus)
**Command:**
```bash
zerion wallet analyze 0xc3f353e9C5ED4a21e9B772d29500a5D1fAc2E0D6
```

### What happened

Ran cleanly with no auth required beyond `ZERION_API_KEY`. No passphrase, no agent token, no interactive prompts. Returned portfolio, positions (26), transactions (sampled 10), and PnL — all in one JSON response.

### Assessment

Read-only analytics commands work perfectly for agents. Clean JSON, fast response, no interactive hurdles. This is how all agent-facing commands should work.

---

## Step 11: Position-Level PnL — NOT AVAILABLE IN CLI

**Date:** 2026-04-02
**Agent:** Claude Code (Opus)

### What happened

After getting the aggregate wallet PnL (-$52 total), the agent was asked to break down PnL by individual position — which tokens are profitable and which are not.

The CLI has no command for this. Here's what exists:

- `wallet pnl` — returns **only aggregate** numbers (total gain, realized, unrealized, fees). Calls `/wallets/{address}/pnl` endpoint. No per-token breakdown.
- `wallet positions` — returns token list with quantities and values, but **no PnL or 24h changes**. The CLI strips this data from the API response.
- `wallet analyze` — combines portfolio + positions + transactions + pnl, but positions still have no PnL attached.

### What the agent had to do

To get per-position PnL, the agent bypassed the CLI entirely and called the Zerion API directly via `curl`:

```bash
curl -s -H "Authorization: Basic ..." \
  "https://api.zerion.io/v1/wallets/{address}/positions/?currency=usd&sort=value"
```

The API **does return** `changes.absolute_1d` and `changes.percent_1d` per position — the data is there, the CLI just doesn't surface it. The agent had to parse raw API JSON to extract 24h PnL per token.

### What we found

The API returns 24h changes, and with that we got:

- ETH (all chains): +2.19% / +$0.14 in 24h
- BNB: -0.95% / -$0.074 in 24h
- USDC: -0.17% (minor depeg)

### Assessment

This is an analytics gap:

1. **`wallet positions` should include 24h changes** — the API returns them, the CLI drops them
2. **`wallet pnl` should support `--by-position` or `--by-token`** — agents and users need to know which tokens are winning/losing, not just the total

For an AI agent doing portfolio analysis, the CLI forces a workaround: call the API directly (breaking the abstraction) to get data that's already available.

---

## Step 12: Token Search — SUCCESS

**Date:** 2026-04-02
**Agent:** Claude Code (Opus)
**Command:**
```bash
zerion search hype
```

### What happened

Returned 10 results instantly. Top hit: HYPE (Hyperliquid) — $36.01, $8.6B market cap, verified. Results include price, 24h change, market cap, verified status, and available chains. Clean JSON, no auth beyond API key.

### Assessment

Search works perfectly for agents. Fast, structured, no interactive prompts.

---

## Recommendations

### 1. Agent token should be part of wallet setup (HIGH)

The `wallet import` and `wallet create` flows should prompt:

```
Wallet created. Create an agent token for unattended trading? (y/n)
```

Or at minimum, print a hint:

```
Tip: run `zerion agent create-token` to enable agent/bot trading without passphrase prompts.
```

Right now the agent token is buried — the agent had to read source code to find it. Every AI agent (Codex, Claude, Cursor) will hit the passphrase wall and not know the escape hatch exists.

### 2. Add `--passphrase-file` for one-time setup commands (HIGH)

For commands that must use a passphrase (wallet import, token creation), allow:
```bash
zerion wallet import --key-file ./key.txt --passphrase-file ./pass.txt
zerion agent create-token --name "bot" --passphrase-file ./pass.txt
```
This unblocks agent workflows for the initial setup, after which `ZERION_AGENT_TOKEN` handles everything else.

### 3. Add `--timeout` and progress output for bridge operations (MEDIUM)

```bash
zerion swap BNB ETH 0.004 --chain bsc --to-chain base --timeout 120 --yes
```
Print progress to stderr: `"Waiting for bridge relay confirmation..."`. Without this, agents can't distinguish a slow bridge from a dead one.

### 4. Implement `send` / `transfer` command (HIGH)

```bash
zerion send ETH 0.01 --to 0x... --chain base --yes
zerion send USDC 10 --to 0x... --chain ethereum --yes
```
A basic token transfer is more fundamental than swap. Without it the CLI can trade but can't move funds — a significant gap for both agents and human users.

### 5. Surface per-position PnL in CLI (HIGH)

`wallet positions` should include 24h changes (API already returns them). `wallet pnl` should support `--by-position` or `--by-token` for per-token breakdown. Without this, agents must bypass the CLI and call the API directly to answer basic questions like "which tokens are profitable?"

### 6. Extend agent token to cover wallet operations (LOW)

Currently `ZERION_AGENT_TOKEN` works for swap/bridge but not wallet import/delete. For full agent autonomy, consider a scoped token that can also perform wallet setup — or a separate `--agent-bootstrap` flow.

---

## Next Steps

- [x] Create an agent token for `Test-Agent-Wallet` and test swap without `expect` — DONE (Step 6)
- [x] Retry cross-chain bridge with agent token — DONE (Step 7, confirmed bridge itself is broken)
- [ ] Debug cross-chain bridge hang (investigate `broadcastAndWait` / Relay provider)
- [x] Test same-chain swaps on other chains (Ethereum, BSC) with agent token
- [ ] Test agent token expiry and revocation
- [ ] Test policy-scoped tokens (deny-transfers, allowlist)
