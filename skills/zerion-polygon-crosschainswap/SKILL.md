---
name: zerion-polygon-crosschainswap
description: "Cross-chain token swaps to and from Polygon (chainId 137) using the Trails SDK. Use when the user wants to bridge or swap tokens across chains where Polygon is the source or destination — e.g. 'swap ETH on Ethereum to USDC on Polygon', 'bridge USDC from Arbitrum to Polygon', or 'swap to POL from any chain'. Supports Widget (drop-in React UI), Headless SDK (custom UX), and Direct API (server-side) integration modes."
license: MIT
allowed-tools: Bash, Read, Edit, Write
---

# Zerion — Polygon Cross-Chain Swap (Trails)

Cross-chain and same-chain token swaps involving Polygon, powered by [Trails](https://docs.trails.build). Trails handles routing, bridging, and settlement in a single intent flow.

## Setup

### 1. Get a Trails API key

Visit [https://dashboard.trails.build](https://dashboard.trails.build) to create an account and generate a key. Then add it to your environment:

```bash
# Client-side (Widget / Headless SDK)
NEXT_PUBLIC_TRAILS_API_KEY=your_key

# Server-side (Direct API)
TRAILS_API_KEY=your_key
```

### 2. Install

```bash
# Widget or Headless SDK (React / Next.js)
npm install @0xtrails/trails

# Direct API (Node.js / backend)
npm install @0xtrails/trails-api
```

Requires React 19.1+ for Widget/Headless (React 18+ supported). Node.js 18+ for Direct API.

---

## When to use

- "Swap [token] on [chain] to [token] on Polygon"
- "Bridge [token] from [chain] to Polygon"
- "Swap ETH / USDC / any token to POL"
- Same-chain swap on Polygon (e.g. USDC → WETH on Polygon)
- Automate cross-chain settlement where Polygon is source or destination

**Polygon chain ID**: `137`

Common Polygon token addresses:

| Symbol | Address |
|--------|---------|
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` |
| WMATIC / POL | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |

Use `getSupportedTokens({ chainId: 137 })` for the live token list.

---

## Integration: Widget (React / Next.js)

Drop-in UI. Recommended for most React apps.

### Provider setup

```tsx
// app/layout.tsx or _app.tsx
import { TrailsProvider } from '@0xtrails/trails';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <TrailsProvider trailsApiKey={process.env.NEXT_PUBLIC_TRAILS_API_KEY!}>
        {children}
      </TrailsProvider>
    </WagmiProvider>
  );
}
```

### Cross-chain swap to Polygon

```tsx
import { TrailsWidget } from '@0xtrails/trails';

// User swaps any token from any chain → USDC on Polygon
// EXACT_INPUT: user picks input amount, receives computed USDC
<TrailsWidget
  mode="swap"
  destinationChainId={137}
  destinationTokenAddress="0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  destinationRecipient="0xUserWalletAddress"
/>
```

### Exact-output payment to Polygon

```tsx
// User pays exactly N USDC on Polygon — input amount is computed
<TrailsWidget
  mode="pay"
  destinationChainId={137}
  destinationTokenAddress="0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  destinationAmount="10000000"   // 10 USDC (6 decimals)
  destinationRecipient="0xMerchantAddress"
/>
```

---

## Integration: Headless SDK (React + custom UI)

Use when you need full control over the UI.

### Provider + modal

```tsx
import { TrailsProvider, TrailsHookModal } from '@0xtrails/trails';

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <TrailsProvider trailsApiKey={process.env.NEXT_PUBLIC_TRAILS_API_KEY!}>
        <TrailsHookModal />   {/* required for headless flows */}
        {children}
      </TrailsProvider>
    </WagmiProvider>
  );
}
```

### Cross-chain swap hook

```tsx
import { useTrailsSendTransaction, useSupportedTokens } from '@0xtrails/trails';

function PolygonSwapButton({ inputAmount }: { inputAmount: string }) {
  const { sendTransaction, isPending } = useTrailsSendTransaction();
  const { data: polygonTokens } = useSupportedTokens({ chainId: 137 });

  const handleSwap = () => {
    sendTransaction({
      destinationChainId: 137,
      destinationTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC on Polygon
      sourceAmount: inputAmount,   // user-specified input
    });
  };

  return (
    <button onClick={handleSwap} disabled={isPending}>
      {isPending ? 'Swapping...' : 'Swap to Polygon'}
    </button>
  );
}
```

---

## Integration: Direct API (Node.js / backend)

Full control over the intent lifecycle. Use for server-side automation or non-React environments.

```typescript
import { TrailsAPI } from '@0xtrails/trails-api';

const trails = new TrailsAPI({ apiKey: process.env.TRAILS_API_KEY! });

async function crossChainSwapToPolygon(
  userAddress: string,
  sourceChainId: number,
  sourceTokenAddress: string,
  inputAmount: string,               // in source token's smallest unit
) {
  // 1. Quote
  const quote = await trails.quoteIntent({
    sourceChainId,
    sourceTokenAddress,
    destinationChainId: 137,         // Polygon
    destinationTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
    amount: inputAmount,
    tradeType: 'EXACT_INPUT',
    userAddress,
  });

  console.log('Estimated output:', quote.estimatedOutput);
  console.log('Quote expires:', quote.expiresAt);

  // 2. Commit (locks the quote)
  const intent = await trails.commitIntent({ quoteId: quote.quoteId });

  // 3. Execute (requires user signature)
  await trails.executeIntent({
    intentId: intent.intentId,
    signature: '0x...', // user's signature
  });

  // 4. Wait for cross-chain settlement
  const receipt = await trails.waitIntentReceipt({
    intentId: intent.intentId,
    timeout: 180000,     // 3 min — cross-chain bridging can take 1-3 min
    pollInterval: 4000,
  });

  console.log('Final status:', receipt.status);
  console.log('Destination tx:', receipt.destinationTransactionHash);
  return receipt;
}
```

### Check supported chains and tokens

```typescript
import { getSupportedChains, getSupportedTokens } from '@0xtrails/trails';

const chains = await getSupportedChains();
const polygonTokens = await getSupportedTokens({ chainId: 137 });
```

---

## Output & config reference

| Parameter | Description |
|-----------|-------------|
| `destinationChainId` | `137` for Polygon |
| `sourceChainId` | Any supported chain |
| `tradeType` | `EXACT_INPUT` (user picks input) or `EXACT_OUTPUT` (user picks output) |
| `amount` | Token amount in smallest unit (e.g. `1000000` = 1 USDC at 6 decimals) |
| `timeout` | Max wait for cross-chain receipt in ms (default 120000; use 300000 for slow routes) |

## Safety checklist

1. Confirm Polygon (137) appears in `getSupportedChains()` — the chain list can update.
2. Use token addresses, not symbols, when the symbol is ambiguous across chains (multiple USDCs).
3. Cross-chain swaps can take 1-5 minutes; set `timeout` ≥ 180000 ms.
4. For EXACT_INPUT, quote `estimatedOutput` is approximate; final output settles on-chain.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | `TRAILS_API_KEY` not set | Set env var; visit dashboard.trails.build |
| `unsupported_chain` | Chain not supported by Trails | Call `getSupportedChains()` for valid IDs |
| `quote_failed` | No route between token pair | Try intermediate token (e.g. USDC) or different source chain |
| `quote_expired` | Took too long between quote and commit | Re-quote and commit immediately |
| `insufficient_balance` | Not enough input token | Check user balance before quoting |
| `slippage_exceeded` | Price moved beyond tolerance | Increase `slippageTolerance` or retry |
| `intent_timeout` | Bridge didn't settle in time | Increase `timeout`; check tx on explorer |
