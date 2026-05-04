---
name: zerion-polygon-deposit
description: "Deposit tokens into DeFi vaults on Polygon (chainId 137) using the Trails SDK. Handles cross-chain bridging + vault deposit in a single intent: user sends tokens from any chain and they land directly in the vault. Supports ERC-4626 vaults, Aave, and custom deposit contracts. Use when the user asks to 'deposit into a vault', 'earn yield on Polygon', 'bridge and stake', or 'put tokens into a DeFi protocol on Polygon'."
license: MIT
allowed-tools: Bash, Read, Edit, Write
---

# Zerion — Polygon DeFi Vault Deposit (Trails)

Bridge tokens from any chain and deposit directly into a DeFi vault on Polygon in a single intent, powered by [Trails](https://docs.trails.build). Trails handles routing, cross-chain settlement, and the vault `deposit` call atomically — no manual approve + deposit step needed.

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
npm install @0xtrails/trails viem

# Direct API (Node.js / backend)
npm install @0xtrails/trails-api viem
```

`viem` is used to encode the deposit calldata. Requires React 19.1+ for Widget/Headless. Node.js 18+ for Direct API.

---

## When to use

- "Deposit USDC into [vault] on Polygon"
- "Bridge ETH from Ethereum and deposit into Aave on Polygon"
- "Stake into a yield vault on Polygon from any chain"
- "Put my tokens to work on Polygon"
- Any ERC-4626-compatible vault or custom `deposit(uint256, address)` contract on Polygon

**Polygon chain ID**: `137`

Common deposit tokens on Polygon:

| Symbol | Address |
|--------|---------|
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` |
| WMATIC / POL | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |

---

## Core concept: Fund mode + calldata

Trails **Fund mode** is `EXACT_INPUT` — the user specifies an input amount and the vault receives the computed output. Because the final settled amount isn't known at encoding time, use the placeholder constant that Trails replaces at execution:

```typescript
// Trails recognizes this value and substitutes the real settled amount
const PLACEHOLDER_AMOUNT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);
```

---

## Integration: Widget (React / Next.js)

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

### ERC-4626 vault deposit widget

```tsx
import { TrailsWidget } from '@0xtrails/trails';
import { encodeFunctionData } from 'viem';

const PLACEHOLDER_AMOUNT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);

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
] as const;

function VaultDepositWidget({
  vaultAddress,
  userAddress,
}: {
  vaultAddress: `0x${string}`;
  userAddress: `0x${string}`;
}) {
  const calldata = encodeFunctionData({
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [PLACEHOLDER_AMOUNT, userAddress],  // Trails fills real amount at execution
  });

  return (
    <TrailsWidget
      mode="fund"
      destinationChainId={137}
      destinationTokenAddress="0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"  // USDC on Polygon
      destinationRecipient={vaultAddress}
      destinationCalldata={calldata}
    />
  );
}
```

### Aave v3 supply widget (Polygon)

Aave uses a `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` signature:

```tsx
import { TrailsWidget } from '@0xtrails/trails';
import { encodeFunctionData } from 'viem';

const PLACEHOLDER_AMOUNT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);

// Aave v3 Pool on Polygon: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
const aavePoolAbi = [
  {
    name: 'supply',
    type: 'function',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

function AaveSupplyWidget({
  userAddress,
}: {
  userAddress: `0x${string}`;
}) {
  const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const;
  const AAVE_POOL_POLYGON = '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as const;

  const calldata = encodeFunctionData({
    abi: aavePoolAbi,
    functionName: 'supply',
    args: [USDC_POLYGON, PLACEHOLDER_AMOUNT, userAddress, 0],
  });

  return (
    <TrailsWidget
      mode="fund"
      destinationChainId={137}
      destinationTokenAddress={USDC_POLYGON}
      destinationRecipient={AAVE_POOL_POLYGON}
      destinationCalldata={calldata}
    />
  );
}
```

---

## Integration: Headless SDK (React + custom UI)

```tsx
import { TrailsProvider, TrailsHookModal, useTrailsSendTransaction } from '@0xtrails/trails';
import { encodeFunctionData } from 'viem';

const PLACEHOLDER_AMOUNT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);

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
] as const;

// Provider setup (in app root)
function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <TrailsProvider trailsApiKey={process.env.NEXT_PUBLIC_TRAILS_API_KEY!}>
        <TrailsHookModal />
        {children}
      </TrailsProvider>
    </WagmiProvider>
  );
}

// Deposit hook
function useVaultDeposit(
  vaultAddress: `0x${string}`,
  userAddress: `0x${string}`,
  depositTokenAddress: `0x${string}`,
) {
  const { sendTransaction, isPending } = useTrailsSendTransaction();

  const deposit = (inputAmount: string) => {
    const calldata = encodeFunctionData({
      abi: erc4626Abi,
      functionName: 'deposit',
      args: [PLACEHOLDER_AMOUNT, userAddress],
    });

    sendTransaction({
      destinationChainId: 137,
      destinationTokenAddress: depositTokenAddress,
      destinationRecipient: vaultAddress,
      destinationCalldata: calldata,
      sourceAmount: inputAmount,
    });
  };

  return { deposit, isPending };
}
```

---

## Integration: Direct API (Node.js / backend)

Full control over quote → commit → execute → wait. Use for server-side automations or non-React environments.

```typescript
import { TrailsAPI } from '@0xtrails/trails-api';
import { encodeFunctionData } from 'viem';

const trails = new TrailsAPI({ apiKey: process.env.TRAILS_API_KEY! });

const PLACEHOLDER_AMOUNT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);

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
] as const;

async function depositToPolygonVault(params: {
  userAddress: string;
  vaultAddress: string;
  depositTokenAddress: string;    // token the vault accepts (on Polygon)
  sourceChainId: number;
  sourceTokenAddress: string;
  inputAmount: string;            // in source token's smallest unit
}) {
  const { userAddress, vaultAddress, depositTokenAddress, sourceChainId, sourceTokenAddress, inputAmount } = params;

  // Encode the vault deposit calldata (placeholder replaced at execution)
  const calldata = encodeFunctionData({
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [PLACEHOLDER_AMOUNT, userAddress as `0x${string}`],
  });

  // 1. Quote — includes bridge + swap + deposit in one route
  const quote = await trails.quoteIntent({
    sourceChainId,
    sourceTokenAddress,
    destinationChainId: 137,           // Polygon
    destinationTokenAddress: depositTokenAddress,
    amount: inputAmount,
    tradeType: 'EXACT_INPUT',
    userAddress,
    destinationRecipient: vaultAddress,
    destinationCalldata: calldata,
  });

  console.log('Estimated vault input:', quote.estimatedOutput);
  console.log('Quote expires:', quote.expiresAt);

  // 2. Commit
  const intent = await trails.commitIntent({ quoteId: quote.quoteId });

  // 3. Execute (user must sign)
  await trails.executeIntent({
    intentId: intent.intentId,
    signature: '0x...', // user's EIP-712 signature
  });

  // 4. Wait for settlement — bridge + vault deposit can take 1-5 min
  const receipt = await trails.waitIntentReceipt({
    intentId: intent.intentId,
    timeout: 300000,    // 5 min for cross-chain + deposit
    pollInterval: 5000,
  });

  console.log('Deposit complete. Status:', receipt.status);
  console.log('Destination tx:', receipt.destinationTransactionHash);
  return receipt;
}
```

---

## Vault ABI patterns

### ERC-4626 (standard)

```typescript
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
] as const;

const calldata = encodeFunctionData({
  abi: erc4626Abi,
  functionName: 'deposit',
  args: [PLACEHOLDER_AMOUNT, receiverAddress],
});
```

### Custom deposit(uint256)

```typescript
const simpleDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

const calldata = encodeFunctionData({
  abi: simpleDepositAbi,
  functionName: 'deposit',
  args: [PLACEHOLDER_AMOUNT],
});
```

### Staking contract

```typescript
const stakingAbi = [
  {
    name: 'stake',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

const calldata = encodeFunctionData({
  abi: stakingAbi,
  functionName: 'stake',
  args: [PLACEHOLDER_AMOUNT],
});
```

---

## Output & config reference

| Parameter | Description |
|-----------|-------------|
| `destinationChainId` | `137` for Polygon |
| `destinationRecipient` | Vault contract address |
| `destinationCalldata` | ABI-encoded deposit call with `PLACEHOLDER_AMOUNT` |
| `tradeType` | Always `EXACT_INPUT` for Fund/Earn mode |
| `mode` | `"fund"` or `"earn"` in Widget |
| `timeout` | Set ≥ 300000 ms for cross-chain + deposit flows |

## Safety checklist

1. **Verify the vault contract** — confirm `destinationRecipient` is a trusted contract on Polygon.
2. **Use `PLACEHOLDER_AMOUNT`** — never hardcode the amount in calldata for Fund/Earn flows; Trails substitutes the real settled amount.
3. **Check token decimals** — USDC uses 6 decimals; WETH and POL use 18.
4. **Test on testnet** — encode and simulate calldata before using in production.
5. **Confirm vault accepts bridged token** — some vaults accept only native USDC (0x3c49...), not USDC.e (0x2791...).

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `missing_api_key` | `TRAILS_API_KEY` not set | Set env var; visit dashboard.trails.build |
| `quote_failed` | No route to vault token | Confirm vault's deposit token is Trails-supported |
| `quote_expired` | Too long between quote and commit | Re-quote and commit immediately |
| `tx_reverted` | Vault deposit call reverted | Verify ABI, token address, and placeholder usage |
| `slippage_exceeded` | Price moved beyond tolerance | Increase `slippageTolerance` or retry |
| `intent_timeout` | Bridge + deposit didn't settle | Increase `timeout` to 300000+; check tx on explorer |
| `unsupported_chain` | Polygon not available | Call `getSupportedChains()` to verify |
