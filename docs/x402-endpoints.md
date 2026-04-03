# x402 Endpoints

Pay-per-call API endpoints using the [x402 protocol](https://www.x402.org/). No API key required ($0.01 USDC per request on Base).

## Prerequisites

Configure at least one wallet key holding USDC. The CLI registers whichever schemes you provide and handles the payment handshake automatically.

**Single key** — format is auto-detected:

```bash
export WALLET_PRIVATE_KEY="0x..."    # EVM (Base) — 0x-prefixed hex
export WALLET_PRIVATE_KEY="5C1y..."  # Solana — base58 encoded keypair
```

**Both chains simultaneously** — use dedicated variables:

```bash
export EVM_PRIVATE_KEY="0x..."       # EVM (Base)
export SOLANA_PRIVATE_KEY="5C1y..."  # Solana

# Optional: prefer Solana when the server offers both networks
export ZERION_X402_PREFER_SOLANA=true
```

When both keys are set, the x402 client registers both schemes and selects the network based on what the server offers (defaulting to EVM unless `ZERION_X402_PREFER_SOLANA=true`).

The CLI uses [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) with [`@x402/evm`](https://www.npmjs.com/package/@x402/evm) or [`@x402/svm`](https://www.npmjs.com/package/@x402/svm) to handle the 402 payment handshake automatically.

## Base URL

```
https://api.zerion.io/v1
```

## Available Endpoints

### Wallet Data

| Endpoint | Description |
|----------|-------------|
| `GET /wallets/:address/portfolio` | Portfolio overview with total value |
| `GET /wallets/:address/positions/` | Token balances and DeFi positions |
| `GET /wallets/:address/transactions/` | Interpreted transaction history |
| `GET /wallets/:address/pnl` | Profit & Loss (realized + unrealized) |
| `GET /wallets/:address/charts/:period` | Portfolio value over time |

### NFTs

| Endpoint | Description |
|----------|-------------|
| `GET /wallets/:address/nft-positions/` | NFTs held by wallet |
| `GET /wallets/:address/nft-collections/` | NFT holdings by collection |
| `GET /wallets/:address/nft-portfolio` | NFT portfolio summary |
| `GET /nfts/` | Search/list NFTs |
| `GET /nfts/:id` | NFT details |

### Tokens (Fungibles)

| Endpoint | Description |
|----------|-------------|
| `GET /fungibles/` | Search/list tokens |
| `GET /fungibles/:id` | Token details |
| `GET /fungibles/:id/charts/:period` | Token price chart |
| `GET /fungibles/by-implementation` | Lookup by contract address |
| `GET /fungibles/by-implementation/charts/:period` | Chart by contract |

### Chains & DApps

| Endpoint | Description |
|----------|-------------|
| `GET /chains/` | List supported chains |
| `GET /chains/:id` | Chain details |
| `GET /dapps/` | List DeFi protocols |
| `GET /dapps/:id` | DApp details |

## Usage

### CLI

```bash
zerion wallet portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
```

### curl

```bash
curl https://api.zerion.io/v1/wallets/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/portfolio
```

### Environment Variable

```bash
export ZERION_X402=true
zerion wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

## Pricing

- **$0.01 USDC per request** on Base (EVM) or Solana
- Payment handled automatically via HTTP 402 protocol
- Agent wallet must have USDC balance on the corresponding network

## Learn More

- [x402 Protocol](https://www.x402.org/)
- [Zerion API Docs](https://developers.zerion.io)
