# MoonPay Prediction Markets

**Purpose:** Trade on prediction markets (Polymarket, Kalshi) using MoonPay CLI. Combines market research from Zerion portfolio analysis with event-based position taking.

## Key Commands

- `mp prediction-market market search --query <topic>` — Find markets by keyword
- `mp prediction-market market trending list` — Top markets by volume
- `mp prediction-market position buy --marketId <id> --outcome <yes|no> --amount <usdc>` — Open a position
- `mp prediction-market position list` — View open positions
- `mp prediction-market position sell --positionId <id>` — Exit a position
- `mp prediction-market pnl retrieve` — Profit/loss across all markets

## Requirements

- MoonPay CLI: `npm i -g @moonpay/cli`
- Funded wallet on Polygon with USDC.e (Polymarket uses Polygon)
- USDC.e address: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`

## Setup: Fund the Polygon wallet

Polymarket requires USDC.e on Polygon. Use MoonPay to bridge or buy:

```bash
# Option A: Buy POL for gas, then bridge ETH to USDC.e
mp buy --token pol_polygon --amount 5 --wallet <address> --email <email>

mp token bridge \
  --from-wallet main --from-chain ethereum \
  --from-token 0x0000000000000000000000000000000000000000 \
  --from-amount 0.01 \
  --to-chain polygon \
  --to-token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Option B: Buy POL for gas directly + buy USDC on Polygon
mp buy --token usdc_polygon --amount 50 --wallet <address> --email <email>
```

Verify:

```bash
mp token balance list --wallet <address> --chain polygon
```

## Trading workflow

### 1. Find a market

```bash
# Search by topic
mp prediction-market market search --query "bitcoin ETF"

# Or browse trending
mp prediction-market market trending list --limit 10
```

### 2. Check market details

```bash
mp prediction-market market price retrieve --marketId <id>
mp prediction-market market price-history list --marketId <id>
```

### 3. Open a position

```bash
# Buy YES on a market with $20 USDC
mp prediction-market position buy \
  --marketId <id> \
  --outcome yes \
  --amount 20

# Buy NO
mp prediction-market position buy \
  --marketId <id> \
  --outcome no \
  --amount 20
```

### 4. Monitor and close

```bash
# View all open positions
mp prediction-market position list

# View P&L
mp prediction-market pnl retrieve

# Sell a position early
mp prediction-market position sell --positionId <id>

# Redeem after market resolves
mp prediction-market position redeem --positionId <id>
```

## Combining with Zerion analysis

Use Zerion's on-chain data to inform macro market calls:

```bash
# Check ETH whale flows before betting on price outcomes
zerion history <whale-address>

# Check DeFi TVL trends before markets that depend on protocol health
zerion positions <defi-protocol-address>

# Then place a prediction market bet based on the on-chain signal
mp prediction-market position buy --marketId <eth-price-market-id> --outcome yes --amount 25
```

## Common Blockers

- Gas required: keep at least $3–5 POL in the wallet for transaction fees
- Market liquidity: check `market price retrieve` — low-liquidity markets have wide spreads
- Position limits: some markets cap individual position size
- Resolution delay: markets resolve after the event; redemption is available after resolution

## Notes

- Polymarket runs on Polygon — all positions are on-chain and non-custodial
- USDC.e (`0x2791...`) is different from native USDC — Polymarket uses USDC.e specifically
- P&L reflects unrealized gains; positions only settle to final value at market resolution

## Related Skills

- **zerion-analyze** — On-chain research to inform market predictions
- **zerion-moonpay-onramp** — Fund the wallet with fiat first
- **zerion-trading** — Move profits back to Ethereum after positions close
