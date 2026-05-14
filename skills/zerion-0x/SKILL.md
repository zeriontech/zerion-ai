---
name: zerion-0x
description: >
  Step-by-step guide for executing token swaps via the 0x API (Swap API v2 and
  Gasless API v2) from within the Zerion Agent. Use this skill when a user wants to:
  swap tokens on any EVM chain using 0x directly (e.g. "swap 0.5 ETH for USDC on
  Arbitrum via 0x", "get a 0x quote for 1000 USDC → WBTC on Base", "gasless swap
  without ETH for gas"); integrate swaps into a dApp or agent workflow in TypeScript or
  Python (Permit2 flow, AllowanceHolder flow); swap with a Gnosis Safe or multisig
  wallet; or debug 0x API errors like INSUFFICIENT_ASSET_LIQUIDITY or allowance
  issues. This is a complex multi-step workflow — always use this skill rather than
  answering from general knowledge. For Zerion-native swaps and bridges, use
  `zerion-trading` instead. Always uses a 0x API key + agent token (no pay-per-call).
mcp_servers:
  - name: 0x-mcp
    url: https://docs.0x.org/_mcp/server
license: MIT
---

# Zerion Agent + 0x API: Direct Swap Integration

You are an expert guide for swapping tokens using the 0x APIs from within a Zerion Agent context. Your role: help the user get a price, get a firm quote, and execute a swap — either standard (user pays gas) or gaslessly (fee deducted from sell tokens).

**When to use this skill vs `zerion-trading`:**

- Use **this skill** when building an integration, writing dApp code, using 0x-specific features (Allowance Holder, Permit2, Gasless API, multisig), or when Zerion CLI's native swap isn't available/preferred.
- Use **`zerion-trading`** for quick CLI-driven swaps via `zerion swap` / `zerion bridge` on supported chains.

## How to use your tools

| Tool                              | When to use                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp__0x-mcp__searchDocs`         | **Always call this first** for any unfamiliar token address, chain detail, error code, or API behavior. The MCP server has live 0x documentation — prefer it over training data. |
| `fetch` (native JS/TS) or `axios` | Use in **developer code samples** you generate for the user. Never call the 0x API yourself via WebFetch — emit working code for the user to run.                                |

> **Rule**: Do not construct raw 0x API HTTP calls yourself via WebFetch. Use `mcp__0x-mcp__searchDocs` to look up current endpoint details, then emit `fetch`/`axios` code for the user.

---

## Step 1: Gather swap details

Before calling the API, collect:

| Field                       | Example                                      | Notes                                                                                                                                          |
| --------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sellToken`                 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | ERC-20 contract address. If user gives a symbol, use `searchDocs` to look up the canonical address — the API does not accept symbols.          |
| `buyToken`                  | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | ERC-20 contract address                                                                                                                        |
| `sellAmount` or `buyAmount` | `100000000`                                  | In token base units (USDC = 6 decimals → 100 USDC = `100000000`)                                                                               |
| `chainId`                   | `1`                                          | See chain table below                                                                                                                          |
| `taker`                     | `0xYourWalletAddress`                        | Required for quotes (not `/price`). Must be the wallet executing the swap. For Zerion wallets: `zerion wallet list --json` to get the address. |

If any field is missing, ask for it before proceeding.

Also ask: **Standard swap (user pays gas) or gasless (fee deducted from sell tokens)?**

- Default to **gasless** if the user doesn't hold native tokens for gas.
- Default to **standard** if selling native ETH/MATIC/BNB — gasless only supports ERC-20 sell tokens.

**Get the Zerion wallet address if needed:**

```bash
zerion wallet list --json | jq -r '.[] | select(.default == true) | .address'
```

---

## Step 2: Choose a swap flow

| Flow                | Endpoint prefix           | Best for                                                                 | Signing complexity                                      |
| ------------------- | ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| **AllowanceHolder** | `/swap/allowance-holder/` | Most integrators; multisigs; teams upgrading from v1                     | approve → send tx (no typed data signing)               |
| **Permit2**         | `/swap/permit2/`          | Time-limited approvals; batching; users with existing Permit2 allowances | approve → sign EIP-712 → append sig → send tx           |
| **Gasless**         | `/gasless/`               | ERC-20 only; user has no gas                                             | sign approval EIP-712 + sign trade EIP-712 → POST to 0x |

**Default to AllowanceHolder** unless the user explicitly wants Permit2 or gasless. It's the simplest path and works with smart contract wallets that can't sign `eth_signTypedData_v4`.

If you're unsure about behavior for a specific flow or chain, call `mcp__0x-mcp__searchDocs` before answering.

---

## Step 3: Show an indicative price

Do **not** call the 0x API yourself. Instead, show the user the correct `fetch` call and explain the key response fields.

### AllowanceHolder / Permit2 price (TypeScript):

```typescript
const params = new URLSearchParams({
  chainId: "1",
  sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  buyToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  sellAmount: "100000000", // 100 USDC
});

const res = await fetch(
  `https://api.0x.org/swap/allowance-holder/price?${params}`,
  {
    headers: {
      "0x-api-key": process.env.ZERO_EX_API_KEY!,
      "0x-version": "v2",
    },
  },
);
const price = await res.json();
console.log("Buy amount:", price.buyAmount);
console.log("Price impact:", price.estimatedPriceImpact);
```

**Key response fields:**

- `buyAmount` — tokens received (in base units)
- `estimatedPriceImpact` — slippage estimate
- `liquidityAvailable` — must be `true` before proceeding
- `issues` — check for balance/allowance problems

### Gasless price:

```typescript
const params = new URLSearchParams({
  chainId: "1",
  sellToken: "0xA0b86991...",
  buyToken: "0xC02aaA39...",
  sellAmount: "100000000",
  taker: "0xYourWalletAddress",
});

const res = await fetch(`https://api.0x.org/gasless/price?${params}`, {
  headers: {
    "0x-api-key": process.env.ZERO_EX_API_KEY!,
    "0x-version": "v2",
  },
});
```

Once the user confirms the price, proceed to Step 4.

---

## Step 4: Get a firm quote

Same pattern as price, but use `/quote` and always include `taker`:

```typescript
const params = new URLSearchParams({
  chainId: "1",
  sellToken: "0xA0b86991...",
  buyToken: "0xC02aaA39...",
  sellAmount: "100000000",
  taker: "0xYourWalletAddress",
});

const res = await fetch(
  `https://api.0x.org/swap/allowance-holder/quote?${params}`,
  {
    headers: {
      "0x-api-key": process.env.ZERO_EX_API_KEY!,
      "0x-version": "v2",
    },
  },
);
const quote = await res.json();
```

> ⚠️ Quotes expire in ~30 seconds. Submit immediately after fetching.

---

## Step 5: Explain execution steps

Walk the user through exactly what to do. You cannot sign or submit transactions — the user does this in their own code or wallet.

### AllowanceHolder (recommended):

**1. Check allowance** — if `quote.issues.allowance` is not null:

```typescript
// Approve the AllowanceHolder contract (use spender from response — never hardcode)
await erc20.approve(quote.issues.allowance.spender, quote.sellAmount);
// Or for a permanent one-time approval:
await erc20.approve(quote.issues.allowance.spender, MaxUint256);
```

⚠️ Never approve `transaction.to` (the Settler contract) directly — loss of funds risk.

**2. Send the transaction:**

```typescript
const txHash = await walletClient.sendTransaction({
  to: quote.transaction.to,
  data: quote.transaction.data,
  value: BigInt(quote.transaction.value),
  gas: BigInt(Math.floor(Number(quote.transaction.gas) * 1.2)), // +20% buffer
  gasPrice: BigInt(quote.transaction.gasPrice),
});
```

### Permit2:

**1. Approve the Permit2 contract** (if `issues.allowance` is not null):

```typescript
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
await erc20.approve(PERMIT2, MaxUint256);
```

**2. Sign the EIP-712 message:**

```typescript
// Strip EIP712Domain from types — viem constructs the domain separator internally
const { EIP712Domain, ...types } = quote.permit2.eip712.types;

const sig = await walletClient.signTypedData({
  domain: quote.permit2.eip712.domain,
  types,
  primaryType: quote.permit2.eip712.primaryType,
  message: quote.permit2.eip712.message,
});
```

**3. Append signature and send:**

```typescript
import { concat, numberToHex, size } from "viem";

const sigLengthHex = numberToHex(size(sig), { signed: false, size: 32 });
const calldata = concat([quote.transaction.data, sigLengthHex, sig]);

const txHash = await walletClient.sendTransaction({
  to: quote.transaction.to,
  data: calldata,
  value: BigInt(quote.transaction.value),
  gas: BigInt(Math.floor(Number(quote.transaction.gas) * 1.2)),
});
```

### Gasless:

**1. Sign both EIP-712 objects** from the quote:

```typescript
const approvalSig = quote.approval
  ? await walletClient.signTypedData({ ...quote.approval.eip712 })
  : undefined;

const tradeSig = await walletClient.signTypedData({ ...quote.trade.eip712 });
```

**2. Submit to 0x:**

```typescript
const submitRes = await fetch("https://api.0x.org/gasless/submit", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "0x-api-key": process.env.ZERO_EX_API_KEY!,
    "0x-version": "v2",
  },
  body: JSON.stringify({
    trade: {
      type: "metatransaction_v2",
      eip712: quote.trade.eip712,
      signature: { ...parseSig(tradeSig), signatureType: "EIP712" },
    },
    ...(approvalSig && {
      approval: {
        type: "permit",
        eip712: quote.approval.eip712,
        signature: { ...parseSig(approvalSig), signatureType: "EIP712" },
      },
    }),
  }),
});
const { tradeHash } = await submitRes.json();
```

**3. Poll for status:**

```typescript
let status;
do {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`https://api.0x.org/gasless/status/${tradeHash}`, {
    headers: { "0x-api-key": process.env.ZERO_EX_API_KEY!, "0x-version": "v2" },
  });
  status = (await r.json()).status;
} while (!["succeeded", "failed", "confirmed"].includes(status));
```

---

## Step 6: Show a clear summary

After the user has the quote, present a summary before execution:

```
Swap Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Selling:    100 USDC
Receiving:  ~0.0412 ETH
Rate:       1 ETH ≈ 2,427 USDC
Mode:       Gasless (no ETH needed)
Chain:      Base (chainId: 8453)
Expires:    ~30 seconds

Next steps:
1. Sign the approval message (if needed)
2. Sign the trade message
3. Submit both signatures
```

---

## API reference

**Base URL**: `https://api.0x.org`

**Required headers on every call:**

- `0x-api-key: YOUR_API_KEY` — get one free at [dashboard.0x.org](https://dashboard.0x.org)
- `0x-version: v2`

**Environment variable**: `ZERO_EX_API_KEY`

**Supported chains:**

| Chain       | Chain ID | Swap API | Gasless API |
| ----------- | -------- | -------- | ----------- |
| Ethereum    | 1        | ✅       | ✅          |
| Arbitrum    | 42161    | ✅       | ✅          |
| Base        | 8453     | ✅       | ✅          |
| Optimism    | 10       | ✅       | ✅          |
| Polygon     | 137      | ✅       | ✅          |
| BNB         | 56       | ✅       | ✅          |
| Avalanche   | 43114    | ✅       | ✅          |
| Blast       | 81457    | ✅       | ✅          |
| Mantle      | 5000     | ✅       | ✅          |
| Scroll      | 534352   | ✅       | ✅          |
| Sonic       | 146      | ✅       | ✅          |
| Abstract    | 2741     | ✅       |             |
| Berachain   | 80094    | ✅       |             |
| HyperEVM    | 999      | ✅       |             |
| Ink         | 57073    | ✅       |             |
| Linea       | 59144    | ✅       |             |
| Mode        | 34443    | ✅       | ✅          |
| Monad       | 143      | ✅       |             |
| Unichain    | 130      | ✅       |             |
| World Chain | 480      | ✅       |             |

For unlisted chains or token addresses, call `mcp__0x-mcp__searchDocs` to verify.

**Common Ethereum mainnet token addresses:**

- WETH: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
- USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- USDT: `0xdAC17F958D2ee523a2206206994597C13D831ec7`
- DAI: `0x6B175474E89094C44Da98b954EedeAC495271d0F`
- WBTC: `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599`

For other chains, always look up addresses via `mcp__0x-mcp__searchDocs`.

---

## Critical safety rules

1. **Never approve the Settler contract.** `transaction.to` may point to a Settler. Only approve the spender from `issues.allowance.spender` or `allowanceTarget` in the API response.
2. **Never hardcode spender addresses.** Always read them from the API response.
3. **Quotes expire in ~30 seconds.** Submit immediately after fetching.
4. **Check `simulationIncomplete`** — if `true`, warn the user the transaction may revert.
5. **Check `liquidityAvailable`** — if `false`, suggest adjusting amount or chain.

---

## Error handling

| Error                          | Cause                    | Fix                                                     |
| ------------------------------ | ------------------------ | ------------------------------------------------------- |
| 400 Bad Request                | Missing/invalid params   | Check `validationErrors` in response body               |
| `INSUFFICIENT_ASSET_LIQUIDITY` | Not enough liquidity     | Reduce amount or try a different chain                  |
| `issues.balance` not null      | User lacks tokens        | Show balance vs required; use `zerion analyze` to check |
| Token not supported by Gasless | Native token as sell     | Fall back to Swap API v2                                |
| `simulationIncomplete: true`   | Simulation didn't finish | Warn user; tx may revert                                |
| Allowance error                | Missing approval         | Run approve step before quote                           |

For any error not listed here, call `mcp__0x-mcp__searchDocs` with the error code.

---

## Related Skills

- **zerion-trading** — Zerion-native swaps/bridges via `zerion swap` / `zerion bridge` (simpler, no API key needed for supported chains)
- **zerion-analyze** — Check portfolio and balances before swapping (`zerion analyze <addr>`)
- **zerion-agent-management** — Set up agent tokens and policies required for Zerion-signed transactions
- **zerion** — Base Zerion CLI reference (auth, wallet setup, chain support)
