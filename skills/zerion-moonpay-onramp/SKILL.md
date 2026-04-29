# MoonPay Fiat Onramp

**Purpose:** Buy crypto with a credit card or bank transfer via MoonPay CLI, then use the funded wallet with Zerion for trading and analysis.

## Key Commands

- `mp buy --token <token> --amount <usd> --wallet <address> --email <email>` — Purchase crypto with fiat
- `mp token balance list --wallet <address> --chain <chain>` — Verify funds arrived
- `mp wallet list` — View wallet addresses

## Requirements

- MoonPay CLI (`npm i -g @moonpay/cli`) — handles fiat-to-crypto purchases
- Zerion CLI (`npm i -g zerion-cli`) — for on-chain analysis and trading after funding
- Wallet address (use `zerion wallet list` or `mp wallet list`)

## Workflow

### 1. Confirm your wallet address

```bash
# Zerion wallet (preferred — shared EVM address)
zerion wallet list

# Or MoonPay wallet
mp wallet list
```

### 2. Buy crypto with fiat

```bash
# Buy ETH on Ethereum mainnet with $100
mp buy \
  --token eth_ethereum \
  --amount 100 \
  --wallet <eth-address> \
  --email <email>
```

MoonPay returns a checkout URL — complete payment in browser. Funds arrive in ~5–30 minutes depending on payment method.

**Common tokens:**

| Token | Symbol | Chain |
|-------|--------|-------|
| Ethereum | `eth_ethereum` | Ethereum |
| Solana | `sol_solana` | Solana |
| Polygon | `pol_polygon` | Polygon |
| USDC (Ethereum) | `usdc_ethereum` | Ethereum |
| USDC (Solana) | `usdc_solana` | Solana |

### 3. Verify funds arrived

```bash
# Check balance on Ethereum
mp token balance list --wallet <address> --chain ethereum

# Or via Zerion analyze
zerion analyze <address>
```

### 4. Start trading with Zerion

Once funded, use the full Zerion trading stack:

```bash
# Swap ETH for USDC
zerion swap eth usdc 0.05

# Bridge to another chain
zerion bridge eth arbitrum 0.05

# Full portfolio view
zerion analyze <address>
```

## Authentication

MoonPay CLI uses its own authentication — run `mp login` on first use. The wallet address is shared between CLIs (same EVM address works in both).

## Common Blockers

- KYC required for purchases above $150 — complete at moonpay.com
- Bank transfers take 1–3 business days; card purchases settle in minutes
- `--email` flag is required for fiat purchases (receipt + KYC link)

## Related Skills

- **zerion-analyze** — Check portfolio after funding
- **zerion-trading** — Swap, bridge, and send once wallet is funded
- **zerion-moonpay-iron** — Wire fiat via IBAN/ACH for larger amounts
