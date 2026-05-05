---
name: zerion-trails-deposit
description: "Deposit tokens into DeFi vaults on Polygon (chainId 137) using the Trails SDK, with Zerion CLI on top for funding and portfolio checks. Handles cross-chain bridging + vault deposit in a single intent: user sends tokens from any chain and they land directly in the vault. Supports Aave, Morpho, and custom ERC-4626 vaults via composable actions or calldata. Use when the user asks to 'deposit into a vault', 'earn yield on Polygon', 'bridge and stake', or 'put tokens into a DeFi protocol on Polygon'."
license: MIT
allowed-tools: Bash, Read, Edit, Write
---

# Zerion — Trails DeFi Vault Deposit

Bridge tokens from any chain and deposit directly into a DeFi vault on Polygon in a single intent, powered by [Trails](https://docs.trails.build). Trails handles routing, cross-chain settlement, and the vault deposit call atomically. Pair with the Zerion CLI to fund the wallet and verify the resulting vault position.

## Setup

### 1. Get a Trails API key

Visit [https://dashboard.trails.build](https://dashboard.trails.build) to create an account and generate a key.

### 2. Install

```bash
# Widget or hooks (React / Next.js) + calldata encoding
npm install 0xtrails viem

# Direct API (Node.js / backend)
npm install @0xtrails/api viem
```

---

## When to use

- "Deposit USDC into [vault] on Polygon"
- "Bridge ETH from Ethereum and deposit into Aave on Polygon"
- "Stake into a yield vault on Polygon from any chain"
- "Put my tokens to work on Polygon"
- Any Aave/Morpho lending market or custom ERC-4626 vault on Polygon

**Polygon chain ID**: `137`  
**Polygon chain name** (widget/hooks): `"polygon"`

Common deposit tokens on Polygon:

| Symbol | Address |
|--------|---------|
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` |
| WMATIC / POL | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |

---

## Zerion CLI integration

Trails handles the bridge + vault deposit; the Zerion CLI handles funding the wallet beforehand and confirming the vault position afterward. Install with `npm i -g zerion-cli`.

### End-to-end flow

```bash
# 1. Fund the wallet (shows EVM + Solana deposit addresses)
zerion wallet fund --wallet agent-bot

# 2. Confirm the source-chain balance is in place before quoting
zerion portfolio --wallet agent-bot

# 3. Run the Trails deposit (Widget / hooks / API — see sections below)

# 4. Verify the vault position appeared on Polygon (DeFi positions)
zerion portfolio --wallet agent-bot
zerion analyze agent-bot --chain polygon --positions defi
```

The Trails SDK runs against the same EVM address that `zerion wallet list` reports — pass that address as `ownerAddress` / `userAddress` and use the vault contract as `destinationToAddress` / `to.recipient` in any of the integration modes below.

---

## Core concept: placeholder amount

Trails deposits are `EXACT_INPUT` — the user specifies the input amount and the vault receives the computed settled amount. Because the final amount isn't known at calldata encoding time, import and use `TRAILS_ROUTER_PLACEHOLDER_AMOUNT` from `0xtrails`:

```typescript
import { TRAILS_ROUTER_PLACEHOLDER_AMOUNT } from '0xtrails'

// Trails replaces this with the real settled amount at execution time
args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT, receiverAddress]
```

Do not use this placeholder for functions that read the token balance internally (e.g. `deposit(address receiver)` without an explicit amount arg).

---

## Integration: Widget (React / Next.js)

Import from `0xtrails/widget`. Components are self-contained and take `apiKey` directly.

### Fund widget — custom vault via calldata

```tsx
import { Fund } from '0xtrails/widget'
import { TRAILS_ROUTER_PLACEHOLDER_AMOUNT } from '0xtrails'
import { encodeFunctionData } from 'viem'

const erc4626Abi = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const

function VaultDepositWidget({
  vaultAddress,
  userAddress,
}: {
  vaultAddress: `0x${string}`
  userAddress: `0x${string}`
}) {
  const calldata = encodeFunctionData({
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT, userAddress],
  })

  return (
    <Fund
      apiKey="YOUR_TRAILS_API_KEY"
      to={{
        recipient: vaultAddress,
        currency: "USDC",
        chain: "polygon",
        calldata,
      }}
      onFundingSuccess={({ sessionId }) => {
        console.log('Deposit complete:', sessionId)
      }}
      onFundingError={({ error }) => console.error(error)}
    />
  )
}
```

### Earn widget — for yield/lending protocols

For supported protocols (Aave, Morpho, Yearn, Compound), use the `Earn` component with composable actions — no manual ABI encoding needed:

```tsx
import { Earn } from '0xtrails/widget'

function AaveDepositWidget() {
  return (
    <Earn
      apiKey="YOUR_TRAILS_API_KEY"
      onEarnSuccess={({ sessionId }) => {
        console.log('Earned:', sessionId)
      }}
    />
  )
}
```

For a specific Polygon lending market, add a `to` config:

```tsx
<Earn
  apiKey="YOUR_TRAILS_API_KEY"
  to={{
    chain: "polygon",
    currency: "USDC",
  }}
  onEarnSuccess={({ sessionId }) => console.log(sessionId)}
/>
```

**Widget props reference:**

| Prop | Type | Description |
|------|------|-------------|
| `apiKey` | string | Trails API key (required) |
| `to.recipient` | string | Vault contract address |
| `to.currency` | string | Token symbol or address |
| `to.chain` | string \| number | Chain name, ID, or viem Chain |
| `to.calldata` | string | ABI-encoded deposit call (use `TRAILS_ROUTER_PLACEHOLDER_AMOUNT`) |
| `to.amount` | string | Fixed deposit amount (optional) |
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

### Aave deposit via composable actions

For supported protocols, use `lend()` from `0xtrails` — Trails handles the contract calls internally:

```tsx
import { useTrailsSendTransaction, lend, useEarnMarkets } from '0xtrails'

function AaveDepositButton({ amount }: { amount: string }) {
  const { data: markets } = useEarnMarkets({ chain: 'polygon', provider: 'aave' })

  const { sendTransaction, isPending } = useTrailsSendTransaction({
    actions: [
      lend({
        marketId: 'polygon-usdc-aave-v3-lending', // use useEarnMarkets to discover IDs
        amount,
      }),
    ],
  })

  return (
    <button onClick={() => sendTransaction()} disabled={isPending}>
      {isPending ? 'Depositing...' : 'Deposit to Aave on Polygon'}
    </button>
  )
}
```

Use `useEarnMarkets` to discover available `marketId` values at runtime rather than hardcoding them:

```tsx
import { useEarnMarkets } from '0xtrails'

function MarketPicker() {
  const { data: markets } = useEarnMarkets({
    chain: 'polygon',
    type: 'lending',      // optional: 'lending' | 'vault'
    provider: 'aave',     // optional: filter by protocol
    sortBy: 'apy',        // optional
  })

  return (
    <ul>
      {markets?.map(m => (
        <li key={m.marketId}>{m.name} — {m.apy}% APY</li>
      ))}
    </ul>
  )
}
```

### Custom vault deposit via calldata

For protocols not natively supported by Trails, encode calldata manually:

```tsx
import { useTrailsSendTransaction, TRAILS_ROUTER_PLACEHOLDER_AMOUNT } from '0xtrails'
import { encodeFunctionData } from 'viem'

const erc4626Abi = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const

function useCustomVaultDeposit(vaultAddress: `0x${string}`, userAddress: `0x${string}`) {
  const { sendTransaction, isPending } = useTrailsSendTransaction()

  const deposit = () => {
    const calldata = encodeFunctionData({
      abi: erc4626Abi,
      functionName: 'deposit',
      args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT, userAddress],
    })

    sendTransaction({
      to: {
        recipient: vaultAddress,
        currency: "USDC",
        chain: "polygon",
        calldata,
      },
    })
  }

  return { deposit, isPending }
}
```

---

## Integration: Direct API (Node.js / backend)

Full control over quote → commit → execute → wait. Use for server-side automation or non-React environments.

```typescript
import { TrailsApi, TradeType } from '@0xtrails/api'
import { TRAILS_ROUTER_PLACEHOLDER_AMOUNT } from '0xtrails'
import { encodeFunctionData } from 'viem'

const trailsApi = new TrailsApi('YOUR_TRAILS_API_KEY')

const erc4626Abi = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const

async function depositToPolygonVault(params: {
  userAddress: string
  vaultAddress: string
  depositTokenAddress: string   // token the vault accepts on Polygon
  originChainId: number
  originTokenAddress: string
  originTokenAmount: bigint     // in source token's smallest unit
}) {
  const { userAddress, vaultAddress, depositTokenAddress, originChainId, originTokenAddress, originTokenAmount } = params

  // Encode vault deposit call — Trails replaces TRAILS_ROUTER_PLACEHOLDER_AMOUNT at execution
  const destinationCallData = encodeFunctionData({
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT, userAddress as `0x${string}`],
  })

  // 1. Quote — includes bridge + swap + vault deposit in one route
  const { intent, gasFeeOptions } = await trailsApi.quoteIntent({
    ownerAddress: userAddress,
    originChainId,
    originTokenAddress,
    originTokenAmount,
    destinationChainId: 137,            // Polygon
    destinationTokenAddress: depositTokenAddress,
    destinationToAddress: vaultAddress,
    destinationCallData,                 // capital D
    tradeType: TradeType.EXACT_INPUT,
    options: {
      slippageTolerance: 0.005,
    },
  })

  // 2. Commit — pass the full intent object; must execute within 10 minutes
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

  // Alternative: user submits deposit transaction manually
  // await trailsApi.executeIntent({ intentId, depositTransactionHash: '0x...' })

  // 4. Poll until bridge + vault deposit settles (can take 1-5 min)
  let done = false
  let intentReceipt
  while (!done) {
    ;({ intentReceipt, done } = await trailsApi.waitIntentReceipt({ intentId }))
  }

  if (intentReceipt.status === 'SUCCEEDED') {
    console.log('Vault deposit complete:', intentReceipt.destinationTransaction?.txnHash)
  } else {
    throw new Error(`Deposit failed: ${intentReceipt.originTransaction?.statusReason}`)
  }

  return intentReceipt
}
```

**Note on `signIntent`:** This is your wallet's EIP-712 signing function applied to the intent data. With viem, use `signTypedData` on the intent's structured data. Refer to the [Trails execution docs](https://docs.trails.build) for the exact typed data schema.

---

## Calldata patterns

### ERC-4626 standard

```typescript
import { TRAILS_ROUTER_PLACEHOLDER_AMOUNT } from '0xtrails'
import { encodeFunctionData } from 'viem'

const calldata = encodeFunctionData({
  abi: [{
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  }] as const,
  functionName: 'deposit',
  args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT, receiverAddress],
})
```

### Custom deposit(uint256) only

```typescript
const calldata = encodeFunctionData({
  abi: [{
    name: 'deposit',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  }] as const,
  functionName: 'deposit',
  args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT],
})
```

### Staking contract

```typescript
const calldata = encodeFunctionData({
  abi: [{
    name: 'stake',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  }] as const,
  functionName: 'stake',
  args: [TRAILS_ROUTER_PLACEHOLDER_AMOUNT],
})
```

---

## Direct API parameter reference

| Parameter | Type | Description |
|-----------|------|-------------|
| `ownerAddress` | string | User's wallet address |
| `originChainId` | number | Source chain ID |
| `originTokenAddress` | string | Source token address |
| `originTokenAmount` | bigint | Amount in smallest unit |
| `destinationChainId` | number | `137` for Polygon |
| `destinationTokenAddress` | string | Token the vault accepts |
| `destinationToAddress` | string | Vault contract address |
| `destinationCallData` | string | ABI-encoded vault call (capital D) |
| `tradeType` | TradeType | `TradeType.EXACT_INPUT` for all deposit flows |

## Safety checklist

1. **Import `TRAILS_ROUTER_PLACEHOLDER_AMOUNT`** — do not use a raw `BigInt('0xff...')` constant.
2. **Verify the vault contract** — confirm `destinationToAddress` / `to.recipient` is a trusted contract.
3. **Check token decimals** — USDC uses 6 decimals; WETH and POL use 18.
4. **Test calldata encoding** — decode with `decodeFunctionData` from `viem` before using in production.
5. **Confirm vault accepts bridged token** — some vaults accept native USDC (`0x3c49...`) only, not USDC.e (`0x2791...`).
6. **Committed intents expire in 10 minutes** — quote and execute promptly.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | API key not set | Check `TRAILS_API_KEY` or `apiKey` prop |
| `quote_failed` | No route to vault token | Confirm vault's deposit token is Trails-supported |
| `quote_expired` | >5 min since quote | Re-quote and commit immediately |
| `intent_expired` | >10 min since commit | Re-quote, re-commit, then execute |
| `tx_reverted` | Vault deposit call reverted | Verify ABI, token address, and placeholder usage |
| `slippage_exceeded` | Price moved beyond tolerance | Increase `slippageTolerance` or retry |
| `unsupported_chain` | Polygon not available | Call `getChains()` to verify |
