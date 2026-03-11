# Zerion Hosted MCP

This repo treats Zerion's hosted MCP as the primary interface for MCP-native agent environments.

## Endpoint

```text
https://developers.zerion.io/mcp
```

## What to use it for

Use the hosted MCP path when:

- your client already supports MCP
- the model should choose and call tools directly
- you want the fastest path for Cursor or Claude-style agent setups

Use the CLI path when your environment expects shell commands returning JSON.

## Authentication

Two options:

### Option 1: x402 Pay-per-call (Recommended for agents)

No API key needed. Pay $0.01 USDC per request on Base via the [x402 protocol](https://www.x402.org/).

```bash
export WALLET_PRIVATE_KEY="0x..."   # EVM wallet with USDC on Base
export ZERION_X402=true
```

The CLI signs the payment automatically using `@x402/fetch` and `@x402/evm`. Your wallet must hold USDC on Base.

### Option 2: API Key

1. Get a Zerion API key:
   https://dashboard.zerion.io
2. Export it:

   ```bash
   export ZERION_API_KEY="zk_dev_..."
   ```

3. Reuse it in the MCP client config.

This repo's example configs assume an `Authorization: Bearer ...` header for the hosted MCP and standard Basic Auth for raw REST requests.

## Supported clients in this repo

- Cursor: [examples/cursor](../examples/cursor/README.md)
- Claude-compatible remote MCP clients: [examples/claude](../examples/claude/README.md)

## Wallet-analysis walkthrough

Use one of the example wallets:

- `vitalik.eth`
- `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

Then ask:

```text
Analyze this wallet and summarize:
- total portfolio value
- top holdings
- DeFi positions
- recent transactions
- PnL
```

The tool catalog in [`mcp/tools/`](./tools/) documents the concrete wallet capabilities used by the examples and CLI.

## Failure modes

Documented and expected:

- missing or invalid API key
- invalid address or ENS resolution failure
- unsupported chain filters
- rate limits
- temporary upstream timeout
- empty wallet or partially bootstrapped wallet state

Relevant Zerion doc notes behind these behaviors:

- wallet portfolio may require polling for fresh wallets
- wallet positions may take time to bootstrap for some tokens
- wallet transactions and positions accept many filters and pagination params
- Solana support has endpoint-specific limitations
