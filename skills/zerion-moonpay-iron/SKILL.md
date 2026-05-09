# MoonPay Iron Fiat-to-DCA

**Purpose:** Wire USD via bank transfer to an Iron virtual account (IBAN/ACH). MoonPay converts to USDC and delivers to your wallet. Combine with Zerion trading to auto-deploy into any token on a schedule.

## Key Commands

- `mp virtual-account retrieve` — Check Iron account status
- `mp virtual-account create` — Create a new virtual account (requires KYC)
- `mp virtual-account onramp create` — Get IBAN/ACH deposit details
- `mp virtual-account transaction list` — Monitor incoming deposits
- `zerion swap usdc <token> <amount>` — Deploy USDC into target after deposit lands

## Requirements

- MoonPay CLI: `npm i -g @moonpay/cli`
- Zerion CLI: `npm i -g zerion-cli`
- Completed KYC on MoonPay (required for virtual accounts)
- Registered wallet on both CLIs

## Setup

### 1. Create the Iron account

```bash
mp virtual-account create
# Completes KYC via URL — finish in browser

mp virtual-account agreement list
mp virtual-account agreement accept --contentId <id>
```

### 2. Register your wallet

```bash
# Register the wallet that will receive USDC
mp virtual-account wallet register --wallet main --chain ethereum
```

### 3. Create the onramp and get deposit details

```bash
mp virtual-account onramp create \
  --name "Main onramp" \
  --fiat USD \
  --stablecoin USDC \
  --wallet <address> \
  --chain ethereum

mp virtual-account onramp retrieve --onrampId <id>
```

Output includes your IBAN (international wire) or ACH routing + account number (US bank). Wire from your bank to these details — Iron converts automatically to USDC.

### 4. Monitor the deposit

```bash
mp virtual-account transaction list --json \
  | jq '[.items[] | {status, fiatAmount, stablecoinAmount, createdAt}]'
```

### 5. Deploy into a position using Zerion

Once USDC lands, use Zerion to execute the trade:

```bash
# Check how much USDC arrived
zerion positions <address>

# Swap USDC into ETH
zerion swap usdc eth 500

# Or bridge USDC to Arbitrum first, then swap
zerion bridge usdc arbitrum 500
zerion swap usdc eth 500 --chain arbitrum
```

## Manual DCA pattern

Run the swap command daily to dollar-cost average:

```bash
# Deploy $71 per day for 7 days ($500 total into ETH)
zerion swap usdc eth 71
```

Automate with cron (Linux) or launchd (macOS):

```bash
# Linux cron — 9am daily
(crontab -l 2>/dev/null; echo '0 9 * * * zerion swap usdc eth 71 # iron-dca') | crontab -
```

## Notes

- Wire transfers settle in 1–3 business days; ACH in 1 business day
- USDC lands in your registered wallet automatically — no manual claim step
- Iron virtual accounts are a MoonPay product (Iron.fi) — the IBAN is a real bank account number
- Pair with `zerion analyze` before each DCA to check current price levels

## Related Skills

- **zerion-trading** — Execute swaps and bridges after USDC lands
- **zerion-analyze** — Check portfolio and current prices before deploying
- **zerion-moonpay-onramp** — Card/bank purchase for smaller amounts without IBAN setup
