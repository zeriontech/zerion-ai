---
name: true402-rugcheck
description: >
  Rug-check an unfamiliar token before buying it with zerion swap: true402 runs an on-chain buy/sell
  honeypot simulation plus liquidity and ownership checks on Base, Ethereum or BSC, and the swap only
  runs if the verdict is not AVOID. Pay-per-call over x402 (USDC on Base), no account or API key.
license: MIT
---

# true402 Rug Check Before Swap

**Purpose:** Gate `zerion swap` on a true402 rug/honeypot check, so an agent never buys a token it cannot sell — true402 simulates the buy and the sell on-chain, Zerion CLI quotes and executes the trade.

## Key Commands

- `rugcheck <token> [--chain base|ethereum|bsc] [--history]` — on-chain verdict (OK / CAUTION / AVOID) from a buy+sell simulation, taxes, liquidity depth and contract controls. Exits `1` on AVOID, `2` when it cannot check (no free check left and no payer wallet)
- `zerion swap <chain> <amount> <from-token> <to-token> --quote` — price the trade first
- `zerion swap <chain> <amount> <from-token> <to-token>` — execute it
- `zerion positions <address>` — confirm what landed

## Requirements

- true402 rugcheck CLI (15-day release-age cooldown): `npm i -g @true402.dev/rugcheck --min-release-age=15`
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- Optional, for unlimited checks: `export PAYER_PRIVATE_KEY=0x...` — a **separate, low-balance** Base wallet holding a little USDC (each check is about $0.01; gas is sponsored). Without it, the CLI uses true402's small daily free allowance.

## Workflow

### 1. Price the trade
```bash
zerion swap base 50 usdc 0xTOKEN --quote
```

### 2. Rug-check the token, then swap only if it passes
```bash
rugcheck 0xTOKEN --chain base && zerion swap base 50 usdc 0xTOKEN
```
`&&` makes the gate fail closed: AVOID (exit 1) and "could not check" (exit 2) both stop the swap. Before running it, read the verdict to the user: `AVOID` means the simulated sell failed, the round-trip tax is prohibitive, there is no real liquidity, or the contract keeps a dangerous control (mint, pause, blacklist). `CAUTION` lists what to weigh — show the reasons and let the user decide.

### 3. Larger positions on Base: add the liquidity history
```bash
rugcheck 0xTOKEN --chain base --history && zerion swap base 500 usdc 0xTOKEN
```
`--history` also lists liquidity removals already observed for the token and other tokens drained in the same transaction. A sell simulation answers "can I sell right now"; it cannot see a pool that was drained last month and refilled.

### 4. Confirm the position
```bash
zerion positions $WALLET
```

## Common Blockers

- **Exit 2, "free trial isn't available"** — the daily free checks are used up. Set `PAYER_PRIVATE_KEY` to a funded low-balance Base wallet, or stop: do not swap an unchecked token.
- **Solana mints** — this CLI checks EVM tokens (Base, Ethereum, BSC). Do not pass a Solana mint.
- **Not a guarantee** — a check reads the token at this moment. It cannot see off-chain intent, and a token that passes can still be rugged later by its owner.
- The CLI refuses to sign more than $0.10 for one call, so a misconfigured endpoint cannot drain the payer wallet.

## Related Skills

- **capabilities/analyze.md** — portfolio and position context before and after the trade
