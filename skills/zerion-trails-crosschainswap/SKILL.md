---
name: zerion-trails-crosschainswap
description: "Cross-chain token swaps to and from Polygon (chainId 137) using the Trails SDK, with Zerion CLI on top for funding and portfolio checks. Use when the user wants to bridge or swap tokens across chains where Polygon is the source or destination — e.g. 'swap ETH on Ethereum to USDC on Polygon', 'bridge USDC from Arbitrum to Polygon', or 'swap to POL from any chain'. Supports Widget (drop-in React UI), Headless hooks (custom UX), and Direct API (server-side) integration modes."
license: MIT
allowed-tools: Bash, Read, Edit, Write
---

# Zerion — Trails Cross-Chain Swap

Cross-chain and same-chain token swaps involving Polygon, powered by [Trails](https://docs.trails.build). Trails handles routing, bridging, and settlement in a single intent flow. Pair with the Zerion CLI to fund the wallet and check the resulting position before/after the swap.

## Setup

### 1. Get a Trails API key

Visit [https://dashboard.trails.build](https://dashboard.trails.build) to create an account and generate a key.

### 2. Install

```bash
# Widget or hooks (React / Next.js)
npm install 0xtrails

# Direct API (Node.js / backend)
npm install @0xtrails/api
```

---

## When to use

- "Swap [token] on [chain] to [token] on Polygon"
- "Bridge [token] from [chain] to Polygon"
- "Swap ETH / USDC / any token to POL"
- Same-chain swap on Polygon (e.g. USDC → WETH on Polygon)
- Automate cross-chain settlement where Polygon is source or destination

**Polygon chain ID**: `137`  
**Polygon chain name** (for widget/hooks): `"polygon"`

Common Polygon token addresses:

| Symbol | Address |
|--------|---------|
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` |
| WMATIC / POL | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |

---

## Zerion CLI integration

Trails handles the swap; the Zerion CLI handles everything around it — funding the wallet beforehand and verifying the position afterward. Install with `npm i -g zerion-cli`.

### End-to-end flow

```bash
# 1. Fund the wallet (shows EVM + Solana deposit addresses)
zerion wallet fund --wallet agent-bot

# 2. Confirm balance arrived on the source chain before quoting
zerion portfolio --wallet agent-bot

# 3. Run the Trails swap (Widget / hooks / API — see sections below)

# 4. Verify the destination token landed on Polygon
zerion portfolio --wallet agent-bot
zerion analyze agent-bot --chain polygon
```

The Trails SDK runs against the same EVM address that `zerion wallet list` reports — pass that address as `recipient` / `destinationToAddress` / `ownerAddress` in any of the integration modes below.

---

## Integration: Widget (React / Next.js)

Import from `0xtrails/widget`. Each component is self-contained and takes `apiKey` directly — no provider wrapper needed.

### Cross-chain swap to Polygon

```tsx
import { Swap } from '0xtrails/widget'

// User swaps any token from any chain → USDC on Polygon
<Swap
  apiKey="YOUR_TRAILS_API_KEY"
  to={{
    currency: "USDC",
    chain: "polygon",
    recipient: "0xUserWalletAddress",
  }}
  onSwapSuccess={({ sessionId }) => {
    console.log('Swap complete:', sessionId)
  }}
  onSwapError={({ error }) => console.error(error)}
/>
```

### Pre-configure source chain

```tsx
import { Swap } from '0xtrails/widget'

// ETH on Ethereum → USDC on Polygon, source pre-set
<Swap
  apiKey="YOUR_TRAILS_API_KEY"
  from={{
    currency: "ETH",
    chain: "ethereum",
  }}
  to={{
    currency: "USDC",
    chain: "polygon",
    recipient: "0xUserWalletAddress",
  }}
  slippageTolerance={0.005}
  onSwapSuccess={({ sessionId }) => console.log('Done:', sessionId)}
/>
```

### Fixed payment to Polygon (EXACT_OUTPUT)

```tsx
import { Pay } from '0xtrails/widget'

// Merchant receives exactly 10 USDC on Polygon; user pays whatever is needed
<Pay
  apiKey="YOUR_TRAILS_API_KEY"
  to={{
    currency: "USDC",
    chain: "polygon",
    recipient: "0xMerchantAddress",
    amount: "10",           // fixed output amount (human-readable)
  }}
  onPaySuccess={({ sessionId }) => console.log('Payment done:', sessionId)}
/>
```

**Widget props reference:**

| Prop | Type | Description |
|------|------|-------------|
| `apiKey` | string | Trails API key (required) |
| `from.currency` | string | Token symbol or address |
| `from.chain` | string \| number | Chain name, ID, or viem Chain |
| `from.amount` | string | Pre-filled source amount |
| `to.currency` | string | Destination token |
| `to.chain` | string \| number | Destination chain |
| `to.recipient` | string | Recipient address |
| `to.amount` | string | Fixed output amount (EXACT_OUTPUT) |
| `slippageTolerance` | number | e.g. `0.005` for 0.5% |
| `bridgeProvider` | string | e.g. `"CCTP"`, `"RELAY"` |
| `paymentMethod` | string | `"CONNECTED_WALLET"` (default), `"CRYPTO_TRANSFER"`, `"CREDIT_DEBIT_CARD"`, `"EXCHANGE"` |

---

## Integration: Headless hooks (React + custom UI)

Import hooks from `0xtrails`. Hooks require `TrailsProvider` context.

### Provider setup

```tsx
import { TrailsProvider } from '0xtrails'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <TrailsProvider trailsApiKey="YOUR_TRAILS_API_KEY">
      {children}
    </TrailsProvider>
  )
}
```

### Custom swap UI with `useQuote`

```tsx
import { useQuote } from '0xtrails'
import { useWalletClient } from 'wagmi'

function PolygonSwapPanel({ inputAmount }: { inputAmount: string }) {
  const { data: walletClient } = useWalletClient()

  const { quote, send, isLoadingQuote, quoteError } = useQuote({
    walletClient,
    from: {
      token: "ETH",
      chain: "ethereum",
      amount: inputAmount,           // human-readable decimal string
    },
    to: {
      token: "USDC",
      chain: "polygon",
      recipient: "0xUserWalletAddress",
    },
    slippageTolerance: '0.005',
    onStatusUpdate: (states) => console.log('Status:', states),
  })

  return (
    <div>
      {isLoadingQuote && <p>Fetching quote...</p>}
      {quoteError && <p>Error: {quoteError.message}</p>}
      {quote && (
        <div>
          <p>You receive: {quote.destinationAmountFormatted} USDC</p>
          <p>Fee: {quote.totalFeeAmountUsdDisplay}</p>
          <p>ETA: {quote.completionEstimateSeconds}s</p>
          <button onClick={() => send()}>Swap</button>
        </div>
      )}
    </div>
  )
}
```

### Check supported tokens

```tsx
import { useSupportedTokens, useSupportedChains } from '0xtrails'

const { data: polygonTokens } = useSupportedTokens({ chainId: 137 })
const { data: chains } = useSupportedChains()
```

---

## Integration: Direct API (Node.js / backend)

Full control over the intent lifecycle. Use for server-side automation or non-React environments.

```typescript
import { TrailsApi, TradeType } from '@0xtrails/api'

const trailsApi = new TrailsApi('YOUR_TRAILS_API_KEY')

async function crossChainSwapToPolygon(params: {
  userAddress: string
  originChainId: number
  originTokenAddress: string
  originTokenAmount: bigint       // in token's smallest unit (wei / atomic)
}) {
  const { userAddress, originChainId, originTokenAddress, originTokenAmount } = params

  // 1. Quote — returns full intent object + gas fee options
  const { intent, gasFeeOptions } = await trailsApi.quoteIntent({
    ownerAddress: userAddress,
    originChainId,
    originTokenAddress,
    originTokenAmount,
    destinationChainId: 137,                                          // Polygon
    destinationTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
    destinationToAddress: userAddress,
    tradeType: TradeType.EXACT_INPUT,
    options: {
      slippageTolerance: 0.005,
    },
  })

  // 2. Commit — pass the full intent object; returns intentId
  // Must execute within 10 minutes of committing
  const { intentId } = await trailsApi.commitIntent({ intent })

  // 3. Execute — user signs the intent (gasless path)
  await trailsApi.executeIntent({
    intentId,
    depositSignature: {
      intentSignature: await signIntent(intent, walletClient), // EIP-712 sign
      selectedGasFeeOption: gasFeeOptions.feeOptions[0],
      userNonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    },
  })

  // Alternative execute path: user submits the deposit transaction manually
  // await trailsApi.executeIntent({ intentId, depositTransactionHash: '0x...' })

  // 4. Wait for cross-chain settlement
  let done = false
  let intentReceipt
  while (!done) {
    ;({ intentReceipt, done } = await trailsApi.waitIntentReceipt({ intentId }))
  }

  if (intentReceipt.status === 'SUCCEEDED') {
    console.log('Swap complete:', intentReceipt.destinationTransaction?.txnHash)
  }
  return intentReceipt
}
```

**Note:** `signIntent` is your wallet's EIP-712 signing function. With viem:
```typescript
import { signTypedData } from 'viem/actions'
// use intent.metaTxns or intent.calls to construct the typed data to sign
// Refer to Trails documentation for the exact signing schema
```

### Check supported chains and tokens

```typescript
import { TrailsApi } from '@0xtrails/api'

const trailsApi = new TrailsApi('YOUR_TRAILS_API_KEY')

// Discover supported chains
const { chains } = await trailsApi.getChains()

// Discover tokens available on Polygon
const { tokens } = await trailsApi.getTokenList({ chainIds: [137] })

// Check if a specific route exists
const { tokens: routes } = await trailsApi.getExactInputRoutes({
  originChainId: 1,
  originTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
  destinationChainId: 137,
})
const canRoute = routes.length > 0
```

---

## Direct API parameter reference

| Parameter | Type | Description |
|-----------|------|-------------|
| `ownerAddress` | string | User's wallet address |
| `originChainId` | number | Source chain ID |
| `originTokenAddress` | string | Source token contract address |
| `originTokenAmount` | bigint | Amount in smallest unit (e.g. `100000000n` = 100 USDC) |
| `destinationChainId` | number | `137` for Polygon |
| `destinationTokenAddress` | string | Destination token address |
| `destinationToAddress` | string | Recipient on destination chain |
| `tradeType` | TradeType | `TradeType.EXACT_INPUT` or `TradeType.EXACT_OUTPUT` |
| `options.slippageTolerance` | number | e.g. `0.005` for 0.5% |
| `options.bridgeProvider` | string | `"RELAY"`, `"CCTP"`, etc. |

## Safety checklist

1. Confirm Polygon (`137`) appears in `getChains()` — the supported chain list can change.
2. Cross-chain swaps can take 1-5 minutes — poll `waitIntentReceipt` until `done: true`.
3. Committed intents must be executed within 10 minutes; quotes expire after 5 minutes.
4. For EXACT_INPUT the output amount is estimated; final amount settles on-chain.
5. Use token addresses, not symbols, when the same symbol exists on multiple chains.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | API key not set | Check `TRAILS_API_KEY` or `apiKey` prop |
| `unsupported_chain` | Chain not available | Call `getChains()` for valid IDs |
| `quote_failed` | No route between tokens | Try USDC as intermediate or different source chain |
| `quote_expired` | >5 min between quote and commit | Re-quote and commit immediately |
| `intent_expired` | >10 min between commit and execute | Re-quote, re-commit, then execute |
| `insufficient_balance` | Not enough source token | Check balance before quoting |
| `slippage_exceeded` | Price moved beyond tolerance | Increase `slippageTolerance` or retry |
