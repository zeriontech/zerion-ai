# zerion-ai

**Maintained by Zerion.**

`zerion-ai` is the public, self-contained repo for using Zerion from AI agents and developer tools.

It packages two first-class integration paths:

- **Hosted MCP** for Cursor, Claude, and other MCP-native agent environments
- **`zerion-cli`** for OpenClaw-like and command-based agent runtimes

It also ships one flagship workflow:

- **`wallet-analysis`** as a reusable skill/playbook for portfolio, positions, transactions, and PnL analysis

![Wallet analysis demo](./assets/demo-wallet-analysis.svg)

## 1. Choose your authentication method

### Option A: x402 Pay-per-call (Recommended for agents)

**No API key needed.** Pay $0.01 USDC per request on Base via the [x402 protocol](https://www.x402.org/). The CLI handles the payment handshake automatically using your wallet's private key.

Setup:

```bash
export WALLET_PRIVATE_KEY="0x..."   # EVM wallet with USDC on Base
```

Then use the `--x402` flag:

```bash
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
```

Or enable x402 globally:

```bash
export ZERION_X402=true
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

### Option B: API Key

Get an API key for higher rate limits and production use: [Get your API key](https://dashboard.zerion.io)

- API auth via **HTTP Basic Auth**
- dev keys beginning with `zk_dev_`
- current dev-key limits of **120 requests/minute** and **5k requests/day**

Useful docs:

- [Build with AI](https://developers.zerion.io/reference/building-with-ai)
- [Get Wallet Data With Zerion API](https://developers.zerion.io/reference/getting-started)

## 2. Choose your integration path

### MCP clients

Use this if your agent runtime already supports MCP.

Start here:

- [Hosted MCP quickstart](./mcp/README.md)
- [Cursor example](./examples/cursor/README.md)
- [Claude example](./examples/claude/README.md)

### OpenClaw and CLI-based agents

Use this if your framework models tools as shell commands returning JSON.

```bash
npm install -g zerion-cli
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Start here:

- [OpenClaw example](./examples/openclaw/README.md)
- [CLI usage](./cli/README.md)

## 3. Run the first wallet analysis

### MCP quickstart

1. Export your API key:

   ```bash
   export ZERION_API_KEY="zk_dev_..."
   ```

2. Add the hosted Zerion MCP config from [examples/cursor/mcp.json](./examples/cursor/mcp.json) or [examples/claude/mcp.json](./examples/claude/mcp.json)
3. Ask:

   ```text
   Analyze the wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045.
   Summarize total portfolio value, top positions, recent transactions, and PnL.
   ```

### CLI quickstart

**With x402 (no API key needed):**

```bash
npm install -g zerion-cli
export WALLET_PRIVATE_KEY="0x..."
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
```

**With API key:**

```bash
npm install -g zerion-cli
export ZERION_API_KEY="zk_dev_..."
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Example output:

```json
{
  "wallet": {
    "query": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
  },
  "portfolio": {
    "total": 450000,
    "currency": "usd"
  },
  "positions": {
    "count": 42
  },
  "transactions": {
    "sampled": 10
  },
  "pnl": {
    "available": true
  }
}
```

## Example wallets

This repo uses the same public wallets across examples:

- `vitalik.eth` / `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
- ENS DAO treasury / `0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e`
- Aave collector / `0x25F2226B597E8F9514B3F68F00F494CF4F286491`

## What ships in this repo

- [`mcp/`](./mcp/README.md): hosted Zerion MCP setup plus the wallet-analysis tool catalog this repo relies on
- [`skills/wallet-analysis/`](./skills/wallet-analysis/README.md): the flagship read-only skill
- [`cli/`](./cli/README.md): `zerion-cli` JSON-first CLI
- [`examples/`](./examples/): Cursor, Claude, OpenAI Agents SDK, raw HTTP, and OpenClaw setups

## Failure modes to expect

Both the MCP and CLI surfaces should handle:

- missing or invalid API key
- invalid wallet address
- unsupported chain filter
- empty wallets / no positions
- rate limits (`429`)
- upstream timeout or temporary unavailability

See [mcp/README.md](./mcp/README.md) and [cli/README.md](./cli/README.md) for the concrete behavior used in this repo.
