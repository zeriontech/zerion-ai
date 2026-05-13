---
name: zerion-lifi-earn
description: "Discover yield vaults across 20+ chains and deposit into them from any chain in one transaction using the LI.FI Earn API for vault discovery and LI.FI Composer-powered execution. Zerion CLI funds the wallet beforehand and verifies the resulting DeFi position. Use when the user asks to 'find the best vault', 'deposit into a vault', 'earn yield on Base/Polygon/Ethereum', 'bridge and stake', 'put tokens into DeFi', or 'discover top APY for USDC'. Covers ERC-4626 vaults and major lending markets — coverage varies by chain."
license: MIT
allowed-tools: Bash, Read, Write
---

# Zerion + LI.FI Earn

**Purpose:** Discover the best yield vaults with the LI.FI Earn API, then deposit into them. Use our SDK for same-chain and cross-chain deposits. Pair with the Zerion CLI to fund the wallet beforehand and verify the resulting DeFi position.

## Setup

### 1. Get a LI.FI API key

Sign up at [https://portal.li.fi](https://portal.li.fi) and create a key. The free tier covers **150 requests/minute per key**.

```bash
export LIFI_API_KEY="..."
```

**Security:** never expose `LIFI_API_KEY` in client-side code. Keep it server-side or in a secret store.

### 2. Install LI.FI SDK

```bash
npm install @lifi/sdk viem
```

### 3. Install Zerion CLI

```bash
npm install -g zerion-cli
export ZERION_API_KEY="zk_..."
```

---

## When to use

- "Find the best USDC vault on Base"
- "Deposit ETH from Ethereum into an Arbitrum yield vault"
- "Bridge and stake into a lending market"
- "What's the highest-APY vault for stablecoins right now?"
- "Earn yield on my idle tokens"

## Key commands

- `fetch https://earn.li.fi/v1/vaults` — LI.FI Earn API: vault discovery
- `executeRoute(route)` from `@lifi/sdk` — orchestrates same-chain or cross-chain deposit
- `zerion wallet fund` — Get deposit addresses for the user's wallet
- `zerion portfolio` — Pre-flight balance check and post-deposit verification
- `zerion analyze --positions defi` — Confirm the vault position appeared

## Requirements

- LI.FI API key (free tier, 150 req/min) — `export LIFI_API_KEY="..."`
- LI.FI SDK: `npm install @lifi/sdk viem`
- Zerion CLI + key: `npm install -g zerion-cli; export ZERION_API_KEY="zk_..."`
- A funded EVM wallet on the source chain

---

## End-to-end workflow

### 1. Fund and inspect the wallet

```bash
zerion wallet fund --wallet agent-bot
zerion portfolio --wallet agent-bot
```

### 2. Discover the best vault (LI.FI Earn API)

```typescript
const discoverVaults = async (chainId: number, asset: string) => {
  const params = new URLSearchParams({
    chainId: String(chainId),
    asset,
    sortBy: "apy",
    minTvlUsd: "5000000",
    limit: "5",
  });

  const res = await fetch(`https://earn.li.fi/v1/vaults?${params}`, {
    headers: { "x-lifi-api-key": process.env.LIFI_API_KEY! },
  });
  const { data } = await res.json();
  return data.filter((v: any) => v.isTransactional); // Composer-depositable only
};

const vaults = await discoverVaults(8453, "USDC");
```

**Selection logic an agent should follow:**

- Drop vaults with `isTransactional: false` — Composer can't deposit into those
- Apply a TVL floor (default ≥ $5M) to filter high risk protocols
- Surface top-N with tradeoffs (APY vs TVL vs protocol risk) — let the user choose

Full recipe combining discovery + deposit: [docs.li.fi/earn/recipes/discover-and-deposit](https://docs.li.fi/earn/recipes/discover-and-deposit).

### 3. Deposit via LI.FI SDK

The SDK handles same-chain (single tx) and cross-chain (multi-step) flows through the same interface. `executeRoute` orchestrates allowances, transactions, and bridge-status polling automatically; `updateRouteHook` reports progress to the UI or agent.

```typescript
import { createConfig, getRoutes, executeRoute, EVM } from "@lifi/sdk";
import { createWalletClient, http } from "viem";
import * as chains from "viem/chains";

// 1. Configure the SDK (mutates an internal singleton — no return value)
createConfig({
  integrator: "zerion-cli",
  apiKey: process.env.LIFI_API_KEY,
  providers: [
    EVM({
      getWalletClient: async () => walletClient, // viem WalletClient
      switchChain: async (chainId: number) =>
        createWalletClient({
          account,
          chain: Object.values(chains).find(
            (c: any) => c.id === chainId,
          ) as any,
          transport: http(),
        }),
    }),
  ],
});

// 2. Build the route — same call shape for same-chain and cross-chain
//    NOTE: getRoutes uses `fromChainId` / `fromTokenAddress` (with suffix).
//    The simpler getQuote and the raw REST `/v1/quote` use `fromChain` / `fromToken` (no suffix).
const { routes } = await getRoutes({
  fromChainId: 1, // Ethereum
  toChainId: 8453, // Base (set === fromChainId for same-chain)
  fromTokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum
  toTokenAddress: selectedVault.address, // From step 2
  fromAmount: "1000000000", // 1,000 USDC (6 decimals)
  fromAddress: userAddress,
  toAddress: userAddress,
  // Optional: bias toward single-tx cross-chain routes
  // allowBridges: ["across", "stargateV2"],
});
const route = routes[0];

// 3. Execute — SDK handles 1-step (same-chain) or 2-step (cross-chain) automatically
const executed = await executeRoute(route, {
  updateRouteHook: (updated) => {
    for (const step of updated.steps) {
      const action = step.execution?.actions.at(-1);
      if (action)
        console.log(`[${step.tool}] ${action.type}: ${action.status}`);
    }
  },
});
```

**Single-tx vs multi-step cross-chain.** Most cross-chain routes today are multi-step: bridge step → deposit step (2 user signatures). Some bridges (e.g. Across v4 and Stargate V2 taxi mode) support packing the deposit into the bridge as a destination call, resulting into a single signature. The SDK handles both transparently — agents don't need to branch on it. To bias toward single-tx routes when possible, pass `allowBridges: ['across', 'stargateV2']` to `getRoutes`. These are the two bridges that support destination calls today.

### 4. Verify the position landed

```bash
zerion portfolio --wallet agent-bot
zerion analyze agent-bot --chain base --positions defi
```

The new vault position should appear in `positions defi` within 30 seconds of settlement.

---

## API reference

### `GET https://earn.li.fi/v1/vaults` — vault discovery

| Parameter   | Required | Type   | Notes                                                           |
| ----------- | -------- | ------ | --------------------------------------------------------------- |
| `chainId`   | yes      | number | e.g. `1` Ethereum, `8453` Base, `137` Polygon, `42161` Arbitrum |
| `asset`     | yes      | string | Token symbol or address                                         |
| `sortBy`    | no       | string | `apy`, `tvl`, `apy30d`                                          |
| `minTvlUsd` | no       | string | Filter dust vaults                                              |
| `limit`     | no       | number | Default ~20                                                     |

Response key fields per vault: `name`, `protocol.name`, `address`, `chainId`, `isTransactional`, `analytics.apy.total`, `analytics.apy30d`, `analytics.tvl.usd`.

Full schema: [docs.li.fi/earn-openapi.yaml](https://docs.li.fi/earn-openapi.yaml).

### LI.FI SDK — key methods

| Method                                                                                                                       | Purpose                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createConfig({ integrator, apiKey, providers })`                                                                            | Initialize SDK and register a wallet provider. Mutates an internal singleton — does **not** return a client.                                           |
| `getRoutes({ fromChainId, toChainId, fromTokenAddress, toTokenAddress, fromAmount, fromAddress, toAddress, allowBridges? })` | Build deposit route(s). Set `toTokenAddress` to the vault address.                                                                                     |
| `executeRoute(route, { updateRouteHook })`                                                                                   | Run the route end-to-end — allowances, signatures, bridge polling, step-to-step amount handoff. No client arg; uses the singleton from `createConfig`. |

For raw API access, the underlying endpoints are `GET https://li.quest/v1/quote` (returns the single best route, ready to sign) and `POST https://li.quest/v1/advanced/routes` (returns multiple routes; requires separate step-transaction calls).

**Param-naming gotcha:** `getRoutes` uses `fromChainId` / `fromTokenAddress` (with `Id` / `Address` suffix). `getQuote` and the raw REST `/v1/quote` use `fromChain` / `fromToken` (no suffix). Don't conflate the two.

---

## Common blockers

| Issue                                    | Cause                                                                                               | Fix                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `isTransactional: false` on chosen vault | Vault not yet Composer-supported                                                                    | Pick another vault from results                                                                                                    |
| Cross-chain flow needs 2 user signatures | Selected bridge doesn't support destination calls (common)                                          | Let the SDK guide both signatures (default behavior). To bias toward single-tx, pass `allowBridges: ['stargateV2']` to `getRoutes` |
| `nonce too low` after approval           | Quote was issued before approval tx; nonce baked in                                                 | Re-fetch the quote after the approval confirms. The SDK does this automatically; raw API users must re-fetch                       |
| Token decimals mismatch                  | USDC uses 6 decimals; ETH/POL use 18                                                                | Always derive `fromAmount` from the source token's decimals — don't hardcode                                                       |
| Quote stale on broadcast                 | Price moved beyond slippage tolerance (default 0.5%)                                                | Re-quote before signing; bump `slippage` in route options if hitting reverts                                                       |
| 0.25% LI.FI fee unexpected               | LI.FI takes a fixed 0.25% fee on Composer flows via a `feeCollection` step before the vault deposit | Surface this in the user-facing summary so it's not a surprise; the fee appears in `quote.feeCosts`                                |
| `429 Too Many Requests`                  | Hit 150 req/min free tier limit                                                                     | Cache vault list per agent session; upgrade plan via [portal.li.fi](https://portal.li.fi)                                          |

---

## Related skills

- **zerion-analyze** — full portfolio + positions snapshot, useful for post-deposit verification
- **zerion-wallet** — wallet management primitives that precede every flow
- **zerion-trails-deposit** — alternative deposit path via Trails (different VM, similar end-to-end pattern)
