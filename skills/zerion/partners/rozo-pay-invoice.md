---
name: rozo-pay-invoice
description: >
  Pay a merchant invoice link (OpenRouter Coinbase link, Stripe crypto link, or
  your own Bitrefill account's invoice) from the stablecoin the user already
  holds. Rozo returns a one-time deposit address and exact amount on the chain
  the user picks, Zerion CLI checks the balance and sends, and Rozo settles the
  merchant bill.
license: MIT
---

# Rozo Pay Invoice

**Purpose:** Turn an invoice link into a one-time deposit address with Rozo, then pay it with `zerion send` from the chain where the Zerion wallet already holds USDC or USDT. Rozo settles the merchant bill.

> **Scope:** One job only. The user gives an invoice link, Rozo returns a one-time deposit address and the exact amount on the chain they hold, and Rozo settles the merchant. No swaps, no yield, no balance management. Rozo never holds keys and never signs anything; the Zerion wallet signs the single transfer.

Supported invoices:

| Invoice | How it is paid |
|---------|----------------|
| OpenRouter crypto top-up (a `payments.coinbase.com/payment-links/pl_*` or `payment-sessions/paymentSession_*` link) | `rozo-checkout pay` |
| Stripe crypto link (`crypto.stripe.com/pay/*`) | Rozo HTTP API (`create-invoice`) |
| Your own Bitrefill account's invoice, created with "USDC on Base" | `rozo-checkout pay --bitrefill-invoice` |

Bitrefill: pay only an invoice the user created in their own Bitrefill account for their own purchase. Do not use this flow to buy on behalf of third parties or to resell.

## Key Commands

**Rozo:**
- `rozo-checkout pay <link> --with <coin> --payer <address> --yes --json --no-watch --utm-source zerion-partner`: create a one-time deposit order and print the deposit address and exact amount. No money moves.
- `rozo-checkout pay --bitrefill-invoice <id> --to <invoice address> --amount <usdc> --expires-at <ISO> --with <coin> --yes --json --no-watch --utm-source zerion-partner`: the same for your own Bitrefill account's invoice.
- `rozo-checkout status <rozoPaymentId> --json`: settlement state of the order.

**Zerion CLI:**
- `zerion positions <address>`: find which chain holds enough USDC or USDT.
- `zerion send <USDC|USDT> <amount> --to <deposit address> --chain <chain>`: pay the deposit.
- `zerion history <address>`: confirm the transfer landed.

## Requirements

- Zerion CLI: `npx zerion-cli@latest init`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- Rozo checkout CLI: `npm i -g @rozoai/checkout@0.1.15 --min-release-age=0`
  - One-off cooldown override: 0.1.15 is the first release with both `--utm-source` and Bitrefill support, and it is inside the 15 day release-age window until 2026-10-21. After that date use `npm i -g @rozoai/checkout --min-release-age=15`.
- Attribution: always pass `--utm-source zerion-partner` (or `export ROZO_CHECKOUT_UTM_SOURCE=zerion-partner`). It is a channel label only, no identity.
- `jq` for the Stripe path: `brew install jq` / `apt install jq`
- No Rozo account and no API key. Rozo endpoints are keyless.

Coins this flow can pay with from a Zerion wallet:

| `--with` | Zerion `--chain` | Rozo `chainId` |
|----------|------------------|----------------|
| `usdc-base` | `base` | `8453` |
| `usdc-ethereum`, `usdt-ethereum` | `ethereum` | `1` |
| `usdc-polygon`, `usdt-polygon` | `polygon` | `137` |
| `usdc-bnb`, `usdt-bnb` | `binance-smart-chain` | `56` |

Rozo also accepts Solana, Stellar and Lightning, but those are paid outside Zerion CLI (Zerion CLI does not send SPL tokens yet).

## Workflow

### 1. Pick the coin the wallet already holds

```bash
export WALLET=<your-evm-address>
zerion positions $WALLET
```

Pick one chain from the table above where USDC or USDT covers the invoice plus a small fee. Do not swap or bridge to make it fit; if no chain has enough, stop and tell the user.

### 2a. OpenRouter (Coinbase) link: create the deposit order

```bash
rozo-checkout pay "<coinbase-link>" --with usdc-base --payer $WALLET \
  --yes --json --no-watch --utm-source zerion-partner > rozo-order.json

jq '.success, .order.rozoPaymentId, .order.deposit.receiverAddress, .order.deposit.amount, .order.expiry.effectiveDeadlineIso' rozo-order.json
```

Show the user the merchant, invoice amount and deposit amount from the quote before paying. The fee is already inside `deposit.amount`.

### 2b. Your own Bitrefill account's invoice: create the deposit order

The user creates the invoice in their own Bitrefill account with "USDC on Base" and gives you its id, payment address, amount and expiry.

```bash
rozo-checkout pay --bitrefill-invoice <invoice-id> --to <invoice-payment-address> \
  --amount <usdc-amount> --expires-at <ISO-time> --with usdt-polygon \
  --yes --json --no-watch --utm-source zerion-partner > rozo-order.json

jq '.success, .order.rozoPaymentId, .order.deposit.receiverAddress, .order.deposit.amount, .order.expiry.effectiveDeadlineIso' rozo-order.json
```

### 2c. Stripe crypto link: create the deposit order over HTTP

The CLI covers Coinbase and Bitrefill. For a `crypto.stripe.com/pay/*` link, call the keyless Rozo API directly with the same attribution label:

```bash
curl -s -X POST https://apiserver.mpprouter.dev/v1/services/rozo-agent-api/create-invoice \
  -H 'Content-Type: application/json' \
  -d '{"url":"<stripe-link>","source":{"chainId":"8453","tokenSymbol":"USDC"},"attribution":{"utm_source":"zerion-partner"}}' \
  > rozo-order.json
ROZO_ID=$(jq -r '.rozoPaymentId' rozo-order.json)

curl -s "https://intentapiv4.rozo.ai/functions/v1/payment-api/payments/$ROZO_ID" \
  | jq '.source | {chainId, tokenSymbol, receiverAddress, amount}'
```

`ok: false` means nothing was created; show the `message` to the user and stop.

### 3. Pay the exact amount with Zerion

```bash
zerion send USDC <deposit.amount> --to <deposit.receiverAddress> --chain base
```

Send exactly `deposit.amount` of the chosen token, on the chosen chain, to that address, once. The address is single use for this order. Pay before `effectiveDeadlineIso` with at least 10 minutes to spare.

### 4. Confirm settlement

```bash
zerion history $WALLET
rozo-checkout status <rozoPaymentId> --json | jq -r '.state, .escalate'
```

For a Stripe order use `curl -s "https://apiserver.mpprouter.dev/v1/services/rozo-agent-api/invoice-status?rozo_payment_id=<rozoPaymentId>"`.

The invoice is paid only when `state` is `settled`. Exit code 0 alone does not mean settled.

## Common Blockers

- **Paying twice:** never pay a saved deposit address again. Before retrying a link, run `rozo-checkout status <rozoPaymentId>`. Re-running the same `pay` command returns the same open order instead of creating a new one.
- **Order expired unfunded:** nothing was charged. Run `pay` again for a fresh deposit address.
- **`escalate: true` (underpaid, stuck after payment):** do not pay again. Contact Rozo support (hi@rozo.ai) with the link, `rozoPaymentId` and the tx hash from `zerion history`.
- **Wrong amount or token:** send exactly `deposit.amount` of the token you chose with `--with`. A different token or chain is not credited automatically.
- **Link already paid or expired:** `pay` refuses before any address is shown. Ask the user for a new invoice link.
- **Crypto payments to OpenRouter are not refundable** (OpenRouter policy). Confirm the credit amount with the user before step 3.

## Related Skills

- **capabilities/analyze.md**: check balances before paying
- **capabilities/trading.md**: `zerion send` details and flags
- Rozo checkout CLI docs: https://github.com/RozoAI/rozo-checkout-skill
