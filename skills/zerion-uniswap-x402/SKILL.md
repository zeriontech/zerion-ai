---
name: zerion-uniswap-x402
description: >
  Pay HTTP 402 (x402) payment challenges using any token via Uniswap swaps,
  with Zerion CLI handling cross-chain balance checks and optional bridging beforehand.
license: MIT
---

# Uniswap x402 Payments with Cross-Chain Funding

**Purpose:** Use Zerion CLI to verify and optionally position capital across chains, then pay x402 HTTP 402 challenges in any token using the Uniswap `/pay-with-any-token` skill.

> **Scope:** This skill covers x402 only. MPP/Tempo is out of scope.

## Key Commands

**Uniswap skill (invoke in agent context):**
- `/pay-with-any-token` — pays an x402 HTTP 402 challenge by swapping tokens via Uniswap

**Zerion CLI (shell):**
- `zerion positions <address>` — check token balances by chain
- `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token> --to-address <address> --cheapest` — optionally pre-position capital to the signing wallet
- `zerion portfolio <address>` — verify balance before paying

## Requirements

- Uniswap AI skills: `npx skills add Uniswap/uniswap-ai`
- Zerion CLI: `npx -y zerion-cli init -y --browser`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- Uniswap API key: `export UNISWAP_API_KEY="..."`
- `cast` (Foundry): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- `jq`: `brew install jq` / `apt install jq`
- An x402-compatible endpoint to pay (see [x402 docs](https://x402.org))

## Wallet Setup

> **Critical:** `/pay-with-any-token` signs EIP-3009 using the wallet referenced by your keystore or `PRIVATE_KEY` env var. Zerion CLI manages its own wallet separately. For the flow to work end-to-end, both must point to the same key.

**Import your EVM key into Zerion CLI:**
```bash
zerion wallet import --evm-key
```

**Import the same key into cast (recommended — encrypted keystore, no plaintext in env):**
```bash
cast wallet import <name> --interactive
```
Zerion CLI encrypts keys via OpenWallet. Using cast keystore keeps both layers encrypted and avoids exposing a raw key in the environment.

If using `PRIVATE_KEY` directly instead:
```bash
export PRIVATE_KEY=0x...  # plaintext — only use in trusted environments
```

Set your signing wallet address:
```bash
export WALLET=<your-evm-address>
```

## Workflow

### 1. Check agent wallet balances by chain
```bash
zerion positions $WALLET
```
Identify which chain holds sufficient liquidity. If balance is sufficient on the target chain, skip to step 4 — `/pay-with-any-token` will source funds itself.

### 2. (Optional) Pre-position capital with Zerion CLI

Two paths — choose one:

**Path A — Pre-bridge with Zerion CLI:**
```bash
zerion bridge ethereum USDC 50 base USDC --to-address $WALLET --cheapest
```
Funds land in the signing wallet on the target chain. Use `--cheapest` to minimise bridge fees.

**Path B — Skip the bridge:**
Let `/pay-with-any-token` handle funding via its internal phase 4a/4b sourcing. No Zerion bridge step needed.

> If you pre-bridge (Path A), the trading API funding phase does not run. If you skip (Path B), `/pay-with-any-token` sources funds itself. Both paths work — pre-bridging gives you explicit control; skipping is simpler if funds are already available.

### 3. Verify balance (Path A only)
```bash
zerion portfolio $WALLET
```
Confirm the bridge completed and the target chain balance is sufficient before proceeding.

### 4. Pay the x402 challenge
Invoke the Uniswap skill in your agent context:
```
/pay-with-any-token
```
The skill handles token selection, swap routing, EIP-3009 signing, and payment submission.

## Reference Behavior

Validate end-to-end behavior against:
[`evals/suites/pay-with-any-token/cases/x402-detection-probe.md`](https://github.com/Uniswap/uniswap-ai/blob/main/evals/suites/pay-with-any-token/cases/x402-detection-probe.md)

Future changes on either side should be tested against this eval case.

## Common Blockers

- **Two separate wallets** — most common failure. Ensure `zerion wallet import --evm-key` and your cast keystore or `PRIVATE_KEY` all reference the same key
- **Insufficient balance after bridge** — bridges can take 1–3 minutes; re-run `zerion portfolio $WALLET` to confirm arrival before invoking `/pay-with-any-token`
- **Wrong chain** — `zerion positions` shows balances per chain; ensure the signing wallet holds funds on the chain the x402 endpoint requires
- **Bridge tx pending** — run `zerion history $WALLET` to check bridge transaction status
- **Missing `jq` or `cast`** — `/pay-with-any-token` requires both; install before running

## Related Skills

- **zerion-uniswap-lp** — plan Uniswap LP positions using Zerion CLI portfolio context
