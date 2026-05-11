---
name: zerion-uniswap-x402
description: >
  Pay HTTP 402 (x402) payment challenges using any token via Uniswap swaps,
  with Zerion CLI handling cross-chain balance checks and bridging beforehand.
license: MIT
---

# Uniswap x402 Payments with Cross-Chain Funding

**Purpose:** Use Zerion CLI to verify and position capital across chains, then pay HTTP 402 challenges in any token using the Uniswap `/pay-with-any-token` skill.

## Key Commands

**Uniswap skill (invoke in agent context):**
- `/pay-with-any-token` — pays an x402 or MPP HTTP 402 challenge by swapping tokens via Uniswap

**Zerion CLI (shell):**
- `zerion positions <address>` — check token balances by chain
- `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>` — move capital to the required chain
- `zerion portfolio <address>` — verify post-bridge balance before paying

## Requirements

- Uniswap AI skills: `npx skills add Uniswap/uniswap-ai`
- Zerion CLI: `npx -y zerion-cli init -y --browser`
- An x402-compatible endpoint to pay (see [x402 docs](https://x402.org))

## Workflow

### 1. Check agent wallet balances by chain
```bash
zerion positions $AGENT_WALLET
```
Identify which chain holds sufficient liquidity for the payment.

### 2. Bridge to the required chain if needed
```bash
zerion bridge ethereum USDC 50 base USDC --cheapest
```
Move capital to the chain where the x402 challenge is denominated. Signature: `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>`.

### 3. Verify the balance landed
```bash
zerion portfolio $AGENT_WALLET
```
Confirm the bridge completed and the target chain balance is sufficient before proceeding.

### 4. Pay the x402 challenge
Invoke the Uniswap skill in your agent context:
```
/pay-with-any-token
```
The skill handles token selection, swap routing, and payment submission via Uniswap.

## Common Blockers

- **Insufficient balance after bridge** — bridges can take 1–3 minutes; re-run `zerion portfolio` to confirm arrival before invoking `/pay-with-any-token`
- **Wrong chain** — `zerion positions` shows balances per chain; ensure you bridge to the chain the x402 endpoint requires
- **Bridge tx pending** — run `zerion history $AGENT_WALLET` to check bridge transaction status

## Related Skills

- **zerion-uniswap-lp** — deploy Uniswap LP positions after positioning capital with Zerion CLI
