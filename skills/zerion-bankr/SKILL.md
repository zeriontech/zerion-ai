---
name: zerion-bankr
description: >
  Research wallets with Zerion CLI (portfolios, positions, PnL, history across 41+ chains), then execute every action with Bankr — spot swaps, cross-chain bridges, DCA/limit/stop-loss automation, Hyperliquid leverage, Polymarket bets, transfers, NFT trades, and token deployment. Bankr signs and broadcasts from its own multi-chain wallet (Base, Ethereum, Polygon, Solana, Unichain); Zerion stays read-only.
license: MIT
---

# Zerion + Bankr: Research → Execute

**Purpose:** Pair Zerion CLI's interpreted, multi-chain wallet data with Bankr's natural-language execution layer so an AI agent can go from on-chain insight to signed transaction in one workflow.

**Architecture:** Zerion CLI is the research layer (interpreted wallet data across 41+ chains, works on any address) and has its own swap/bridge for direct execution. This skill complements that by routing actions through Bankr to reach surfaces Zerion doesn't natively cover — Hyperliquid perps, Polymarket, scheduled automation (DCA, limit, stop-loss), social-handle transfers, NFT trades, Base token deploys, and x402 paid APIs. One Bankr wallet covers the full action surface.

## Key Commands

**Zerion (research used here):**
- `zerion analyze <addr>` — full portfolio, positions, transactions, PnL
- `zerion portfolio <addr>` — USD value + chain distribution
- `zerion positions <addr>` — token + DeFi positions
- `zerion pnl <addr>` — realized & unrealized P&L
- `zerion history <addr>` — interpreted transaction history

**Bankr (execution):**
- `bankr wallet portfolio` — Bankr wallet balances
- `bankr wallet transfer --to <addr> --token <sym> --amount <n>` — direct send (ENS supported)
- `bankr agent prompt "<natural language>"` — swaps, leverage, Polymarket, NFTs, deploys, automation
- `bankr tokens search <q>` / `bankr tokens info <sym>` — token discovery

## Requirements

```bash
# Zerion CLI (read layer)
npm install -g zerion-cli
export ZERION_API_KEY="zk_..."     # or pass --x402 to pay $0.01 USDC per request

# Bankr CLI (execution layer)
bun install -g @bankr/cli           # or: npm install -g @bankr/cli
bankr login email <you@example.com>
# verify OTP with: --accept-terms --agent-api --read-write --key-name "Zerion+Bankr"
```

Capture the Bankr wallet address once — every workflow below feeds it to Zerion:

```bash
BANKR_ADDR=$(bankr whoami --json | jq -r '.address')
```

## Workflows (priority order, highest-value first)

### 1. Automation: DCA, limit orders, stop loss

Use Zerion PnL to set thresholds, Bankr to schedule the strategy.

```bash
zerion pnl $BANKR_ADDR

bankr agent prompt "DCA \$100 into ETH every Friday"
bankr agent prompt "Buy ETH if price drops to \$3000"
bankr agent prompt "Stop loss on my ETH at -20%"
```

### 2. Copy-trade a profitable wallet

Zerion's interpreted history + PnL on any address makes this practical.

```bash
WHALE=0xWHALE_ADDRESS
zerion pnl $WHALE
zerion history $WHALE

bankr agent prompt "Buy \$50 of <token> on <chain>"
```

### 3. Hyperliquid leverage hedging

Bankr's unique Hyperliquid + Avantis integration (up to 50x crypto, 100x forex).

```bash
zerion positions $BANKR_ADDR        # see spot exposure

bankr agent prompt "Short \$500 of ETH on Hyperliquid with 5x leverage"
bankr agent prompt "Open 10x long on BTC with stop loss at 45000"
bankr agent prompt "Show my Hyperliquid positions"
```

### 4. Polymarket prediction-market bets

Size bets against actual free balance.

```bash
zerion positions $BANKR_ADDR

bankr agent prompt "What are the odds on <market topic>?"
bankr agent prompt "Bet \$10 on Yes for <market>"
bankr agent prompt "Show my Polymarket positions"
```

### 5. Advanced: x402 paid APIs, arbitrary calldata, web browse, LLM gateway

Unlocks agent power-features.

```bash
zerion analyze $BANKR_ADDR          # confirm wallet readiness for paid calls / arb tx

bankr agent prompt "Find x402 endpoints for sentiment analysis"
bankr agent prompt "Call the weather endpoint on x402"
bankr agent prompt "Submit this transaction: {to:0x..., data:0x..., value:0, chainId:8453}"
bankr agent prompt "Browse coingecko.com and get the top trending tokens"

bankr llm credits add 25            # top up gateway credits from Bankr wallet
bankr llm models                    # list Claude / GPT / Gemini available via gateway
```

### 6. Deploy a token on Base

Bankr deploys ERC20 tokens on Base only.

```bash
zerion portfolio $BANKR_ADDR        # confirm ETH on Base for gas + deployment funds

bankr agent prompt "Deploy a token called MoonShot with symbol MOON on Base"
bankr agent prompt "Claim my creator fees for MOON"
```

### 7. Spot trade informed by portfolio analysis

```bash
zerion analyze $BANKR_ADDR

bankr agent prompt "Buy \$100 of ETH on Base"
bankr agent prompt "Swap 50 USDC for PEPE on Base"
bankr agent prompt "Sell 50% of my PEPE"
```

### 8. Cross-chain rebalance

Zerion's per-chain distribution is sharper than Bankr's single-chain views.

```bash
zerion portfolio $BANKR_ADDR        # see chain-by-chain allocation

bankr agent prompt "Bridge 200 USDC from Polygon to Base"
bankr agent prompt "Swap 0.5 ETH for USDC on Base"
```

### 9. Transfers (ENS + social handles)

Bankr resolves `vitalik.eth`, `.base.eth`, `.cb.id` directly; the agent also handles Twitter / Farcaster handles.

```bash
zerion analyze $BANKR_ADDR          # confirm balance pre-send

bankr wallet transfer --to vitalik.eth --token USDC --amount 50 --chain base
bankr agent prompt "Send 0.1 ETH to @friend on Twitter"
```

### 10. NFT browse, buy, transfer

```bash
zerion analyze $BANKR_ADDR          # see current NFT holdings

bankr agent prompt "Show Pudgy Penguin floor price"
bankr agent prompt "Buy the cheapest Pudgy Penguin"
bankr agent prompt "Show my NFTs"
```

### 11. Market research before any trade

Combine Bankr token intel with Zerion whale activity.

```bash
bankr tokens search PEPE
bankr tokens info USDC
bankr agent prompt "Technical analysis on ETH"

zerion history 0xWHALE_HOLDING_TARGET_TOKEN
```

## Common Blockers

- **Bankr key is read-only** — re-login with `--read-write --agent-api` or every write returns 403
- **Wallet-level safety limits** — Bankr defaults to $500 per tx and $500 / 24h at bankr.bot → Security; raise before large rebalances or deploys
- **Wrong chain in prompt** — always say `on Base` / `on Solana` / `on Polygon`, or trades may pick the wrong network
- **Execution path** — this skill routes every action through Bankr so one wallet covers everything (Hyperliquid, Polymarket, automation, etc.). Zerion's native `zerion swap` / `zerion bridge` work great standalone if you'd rather sign there — see the `zerion-trading` skill
- **Rate limits** — Bankr ships 100 msg/day standard, 1,000/day with Bankr Club; Zerion API has its own per-key tier
- **LLM credits are separate from the trading wallet** — `bankr llm credits add <n>` before using the gateway
- **Polymarket lives on Polygon** — Bankr handles routing, but ensure the Bankr wallet has USDC + a little MATIC for gas
- **Hyperliquid is its own L1** — funded via Bankr's bridge; first leverage prompt may take a moment to provision

## Related Skills

- **zerion-analyze** — deeper coverage of `zerion analyze` for any address
- **zerion** — base Zerion CLI reference (endpoints, x402 access)
- **zerion-trading** — execution via Zerion's own swap/bridge (uses a Zerion wallet — not used here)
