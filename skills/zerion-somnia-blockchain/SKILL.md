---
name: somnia-blockchain
description: Comprehensive Somnia blockchain knowledge — network info, unique features, gas model, and deployment guidance for building on Somnia
---

# Somnia Blockchain

You are now working in the context of the Somnia blockchain. Somnia is an EVM-compatible L1 chain, but it has additional features and differences compared with Ethereum and other EVM chains. This document is your complete reference — use it to write correct, optimized code and give accurate guidance.

## Network Configuration

!`cat references/l1/network-config.json`

Additional RPC providers (Ankr, Public Node, Stakely, Validation Cloud) are listed at https://docs.somnia.network/developer/network-info

When the user does not specify a network, default to **testnet**. Always confirm before deploying to mainnet.

---

## Somnia-Specific Features

Somnia extends the EVM with native capabilities not available on other chains. When building on Somnia, actively consider whether these features can improve the user's application.

### Reactivity

Somnia's event-driven pub/sub system to subscribe to any EVM log / event is baked into the chain. Unlike standard EVM `eth_subscribe` (events only), Somnia pushes **events + state atomically** to subscribers — no polling, no separate state fetches, no inconsistency. It's a powerful primitive for both on-chain and off-chain use.

> **Off-chain subscriptions require a WebSocket (WSS) connection.** Use the `wsUrl` from the network config (e.g. `wss://api.infra.testnet.somnia.network/`) when creating viem clients or direct WebSocket connections for Reactivity.

**Two subscription modes:**

| | Off-chain (TypeScript) | On-chain (Solidity) |
|---|---|---|
| Delivery | WebSocket push | Validator invokes handler contract |
| Cost | No gas per notification | Gas per invocation (min 32 SOM balance) |
| Setup | `npm i @somnia-chain/reactivity`, subscribe | Deploy handler, create + fund subscription |
| Use cases | UIs, dashboards, backends | DeFi automation, reactive mints, oracles |

#### On-chain: Solidity Handlers

Two things are required:

1. **A handler contract** extending `SomniaEventHandler`:

```solidity
import { SomniaEventHandler } from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";

contract MyHandler is SomniaEventHandler {
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        // React to the event
        // CAUTION: emitting events here can cause infinite loops
    }
}
```

2. **A funded subscription** created via the TypeScript SDK:

```typescript
import { SDK } from '@somnia-chain/reactivity';
import { parseGwei } from 'viem';

await sdk.createSoliditySubscription({
  handlerContractAddress: '0x123...',
  priorityFeePerGas: parseGwei('2'),   // min recommended for validators
  maxFeePerGas: parseGwei('10'),        // max willing to pay (base + priority)
  gasLimit: 500_000n,                   // up to 3M for complex handlers
  isGuaranteed: true,                   // deliver even if block distance > 0
  isCoalesced: false,                   // true to batch multiple events
});
```

Subscription creators must hold a minimum balance (currently 32 SOM) to pay for handler invocations executed by validators.

#### Off-chain: TypeScript SDK

```bash
npm i @somnia-chain/reactivity
```

```typescript
import { SDK, SubscriptionInitParams } from '@somnia-chain/reactivity';

const subscription = await sdk.subscribe({
  ethCalls: [],  // state view calls to include with events
  onData: (data) => console.log('Event + state:', data),
});
```

#### System Events: BlockTick and Schedule

The chain itself emits two system events that handlers can subscribe to. Set `emitter` to `SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS` so your handler only responds to genuine system events.

**BlockTick** — fires every block (~10/sec). Specify a block number to trigger once, or omit for every block.

```solidity
event BlockTick(uint64 indexed blockNumber);
```

**Schedule** — one-off future trigger. The subscription auto-deletes after firing.

```solidity
event Schedule(uint256 indexed timestampMillis);
```

Rules for Schedule:
- Timestamp must be in the future (minimum next second from current block)
- Expressed in **milliseconds**

SDK convenience functions (`@somnia-chain/reactivity@0.1.9+`):
- `createOnchainBlockTickSubscription({ handlerContractAddress, ... })` — block tick
- `scheduleOnchainCronJob({ timestampMs, handlerContractAddress, ... })` — one-off schedule

These handle the `SubscriptionData` structure and precompile interactions automatically.

**Status:** Currently available on testnet. Full docs: https://docs.somnia.network/developer/reactivity

### Session RPCs

Session accounts are a **third type of EVM account** on Somnia, alongside EOAs and smart contracts. They allow high-volume transaction submission without nonce management or cryptographic signing — ideal for applications that fire many transactions rapidly (gaming, order placement, automation). Transactions are submitted via `somnia_sendSessionTransaction` instead of `eth_sendRawTransaction`.

> **Testnet only.** Session accounts are currently available on Somnia testnet (chain ID 50312). The `@somnia-chain/viem-session-account` package provides viem-compatible tooling.

| | EOA | Session Account |
|---|---|---|
| Key management | Private key signs every transaction | Seed generates a deterministic address |
| Nonce handling | Manual (or provider-managed) | None — handled by the chain |
| Signing | Required per transaction | None |
| Funding | Send native tokens to EOA address | Send native tokens to session address |
| Best for | General-purpose wallets | High-throughput dApp backends |

#### Setup

```bash
npm i @somnia-chain/viem-session-account viem
```

The package re-exports `somniaTestnet` and `somnia` chain definitions, so you do not need to define them manually with `defineChain` when using session accounts.

#### Generating a Secure Seed

The session seed is the **sole credential** for the session account — treat it like a private key. Generate it with a cryptographically secure random source:

```typescript
import { toHex } from 'viem'
import { randomBytes } from 'node:crypto'

// Node.js — 32 bytes of cryptographically secure randomness
const seed = toHex(randomBytes(32))
```

For browser or edge environments, use the Web Crypto API:

```typescript
import { toHex } from 'viem'

const seed = toHex(crypto.getRandomValues(new Uint8Array(32)))
```

> **Never hardcode seeds.** Store them securely (environment variable, secrets manager) and never commit them to version control.

#### Quick Start

```typescript
import { http } from 'viem'
import { createSessionClient, somniaTestnet } from '@somnia-chain/viem-session-account'

// 1. Create a session client (derives address from seed automatically)
const client = await createSessionClient({
  seed,                    // hex string from secure generation above
  chain: somniaTestnet,
  transport: http(),
})

// 2. Fund the session address with STT before transacting
console.log('Fund this address:', client.account.address)

// 3. Send transactions — no signing, no nonce management
const hash = await client.sendTransaction({
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 STT
})

// 4. Contract interactions work automatically via writeContract
const hash2 = await client.writeContract({
  address: '0xContractAddress',
  abi: myContractAbi,
  functionName: 'myFunction',
  args: [arg1, arg2],
})
```

#### How It Works

1. **Generate a seed** — cryptographically secure random bytes (see above)
2. **Derive the session address** — the package calls `somnia_getSessionAddress` with your seed
3. **Fund the session address** — transfer STT (testnet) directly to the derived address
4. **Transact** — `sendTransaction()` and `writeContract()` route through `somnia_sendSessionTransaction` automatically

#### Raw JSON-RPC Methods

The `@somnia-chain/viem-session-account` package wraps these RPCs, but they can be called directly from any language or tool:

**`somnia_getSessionAddress`** — derive the session address from a seed:

```bash
curl -X POST --data '{
  "jsonrpc": "2.0",
  "method": "somnia_getSessionAddress",
  "params": ["0x<seed>"],
  "id": 1
}' https://api.infra.testnet.somnia.network
```

**`somnia_sendSessionTransaction`** — submit a transaction from a session account (no signing required):

```bash
curl -X POST --data '{
  "jsonrpc": "2.0",
  "method": "somnia_sendSessionTransaction",
  "params": [{
    "seed": "0x<seed>",
    "gas": "0x5208",
    "to": "0xRecipientAddress",
    "value": "0x3e8",
    "data": "0x"
  }],
  "id": 1
}' https://api.infra.testnet.somnia.network
```

These are useful for language-agnostic integrations or environments where viem is not available.

#### Package Exports

| Export | Description |
|---|---|
| `createSessionClient({ seed, chain, transport })` | One-liner: creates account + wallet client + session decorator |
| `createSessionAccount(client, { seed })` | Creates a viem `LocalAccount` from a session seed |
| `sessionActions` | Client decorator for `.extend()` — overrides `sendTransaction` to use session RPC |
| `somniaTestnet`, `somnia` | Chain definitions (chain IDs 50312 and 5031) |

#### Combining with Reactivity

Session accounts pair naturally with Somnia Reactivity for high-throughput reactive systems. Use a session client as the wallet when creating on-chain subscriptions:

```typescript
import { http, createPublicClient } from 'viem'
import { createSessionClient, somniaTestnet } from '@somnia-chain/viem-session-account'
import { SDK } from '@somnia-chain/reactivity'

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(),
})

const sessionClient = await createSessionClient({
  seed,
  chain: somniaTestnet,
  transport: http(),
})

const sdk = new SDK({
  public: publicClient,
  wallet: sessionClient,  // session client instead of EOA wallet
})

// Now all SDK write operations (createSoliditySubscription, etc.)
// go through session RPCs — no nonce conflicts, no signing overhead
```

> For full Reactivity reference (handlers, gas config, troubleshooting), see the `somnia-reactivity` skill.

**Status:** Currently available on testnet. Full docs: https://www.npmjs.com/package/@somnia-chain/viem-session-account

### Somnia Agents

Somnia Agents extend the Somnia blockchain by enabling Smart Contracts and users to trigger decentralized, auditable compute jobs—including LLM-based tasks—executed across Somnia's decentralized network. By integrating with Somnia's native on-chain reactivity, Agents make it possible to build and run fully featured decentralized applications. Agent calls come with validator consensus on results. Contracts send requests to the platform, validators execute the agent, and the result is delivered via callback.

Capabilities
Somnia Agents unlock use cases not possible with traditional EVM Smart Contracts:
- Acting as Oracles: Querying the internet and reliably bringing external data on-chain — see JSON API Request
- Outbound Communication: Triggering actions or sending messages to external internet services
- LLM Invocation: Leveraging on-chain deterministic AI models for autonomous agents — see LLM Inference and LLM Parse Website

Please check the Somnia Agents documentation for the latest contract address if you experience issues.

**Flow:**
1. Your contract calls `createRequest{value: deposit}(agentId, callbackAddress, callbackSelector, payload)` on the platform
2. A validator subcommittee executes the agent off-chain
3. Validators reach consensus (Majority or Threshold)
4. Platform calls your contract's callback with the results
5. Unused funds are rebated

**Key interfaces:**

```solidity
interface ISomniaAgents {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

interface ISomniaAgentsHandler {
    function handleResponse(
        uint256 requestId,
        bytes[] calldata results,
        ResponseStatus status,
        uint256 cost
    ) external;
}

enum ResponseStatus { Pending, Success, Failed, TimedOut }
```

**Getting started:**
- Code generator (generates Solidity + TypeScript): https://agents.testnet.somnia.network/
- Docs: https://docs.somnia.network/agents


---

## Using with Zerion CLI

This skill is most useful when paired with `zerion-cli`. The CLI handles wallet, analysis, and trading; this skill teaches the agent **how Somnia behaves** so those CLI calls succeed and compose with on-chain logic.

**Direct mappings:**

| Zerion CLI action | What this skill adds |
|---|---|
| `zerion swap` / `zerion bridge` on Somnia | Chain IDs (50312 / 5031), gas-cost expectations, slippage guidance |
| `zerion wallet create` then deploying a contract | `--gas-estimate-multiplier 200` for Foundry; Hardhat/viem network configs |
| Tight loops of `zerion swap` (bot-style) | Switch to Session RPCs — no nonce, no per-tx signing |
| `zerion analyze` output that needs LLM follow-up | Pipe into Somnia Agents (`createRequest`) for on-chain inference |
| `zerion sign-typed-data` with a custom contract | Skill provides the EIP-712 domain (chainId, verifyingContract patterns) |

**Example — high-throughput bot with Zerion-side risk rails:**

```bash
# 1. Provision a Zerion agent token scoped tightly
zerion agent create-token --name somnia-bot --wallet trading-bot
zerion agent create-policy --name safe-somnia \
  --chains somnia --expires 7d --deny-transfers
```

```typescript
// 2. Use a Somnia Session client for the actual on-chain trades —
//    no nonce conflicts even at hundreds of tx/sec
import { createSessionClient, somniaTestnet } from '@somnia-chain/viem-session-account'

const client = await createSessionClient({ seed, chain: somniaTestnet, transport: http() })

// fire trades through the session client; use the Zerion token only for
// risk-policied actions that need their facilitator
```

**Example — `zerion analyze` → Somnia Agent on-chain decision:**

```bash
zerion analyze 0xUserWallet --json > /tmp/portfolio.json
```

```solidity
// pass the portfolio summary into a Somnia Agent invocation;
// validators run an LLM and return a rebalance recommendation on-chain
somniaAgents.createRequest{value: deposit}(
    LLM_INFERENCE_AGENT_ID,
    address(this),
    this.handleRebalance.selector,
    abi.encode(portfolioSummary)
);
```

For event-driven combos (copy-trade, scheduled DCA, live dashboards), see the `somnia-reactivity` skill.

---

## Somnia Gas Model

Somnia's gas model differs **significantly** from Ethereum. You must account for these differences when writing and optimizing contracts.

| Operation | Somnia | Ethereum | Impact |
|---|---|---|---|
| SLOAD (warm) | 100 gas | 100 gas | Same |
| SLOAD (cold) | 1,000,100 gas | 2,100 gas | **~476x more expensive** |
| SSTORE (new slot) | 200,100 gas | 22,100 gas | **~9x more expensive** |
| Account access (cold) | 1,000,000 gas | 2,600 gas | **~385x more expensive** |
| New account creation | 400,000 gas | 25,000 gas | **16x more expensive** |
| Contract bytecode | 3,125 gas/byte | 200 gas/byte | **~16x more expensive** |
| KECCAK256 | 1,250 + 300/word | 30 + 6/word | **~42-50x more expensive** |
| LOG0 | 8,320 gas | 631 gas | **~13x more expensive** |
| Precompiles | 10-250x Ethereum | baseline | Much more expensive |

**Storage architecture:**
- 128M-slot IceDB cache for storage — warm access = 100 gas, cold access = 100 + 1,000,000 gas
- 32M-account cache — cold account access = 1,000,000 gas

### Optimization Guidelines

When writing Solidity for Somnia, apply these principles:

1. **Minimize cold storage reads.** Re-use warm slots. Cache storage values in memory variables when accessed multiple times.
2. **Minimize new storage writes.** Creating new storage slots is expensive. Re-use existing slots where possible.
3. **Keep contracts small.** Bytecode costs 3,125 gas/byte — use libraries, proxies, or diamond patterns for large codebases.
4. **Reduce hashing.** KECCAK256 is ~50x more expensive. Avoid unnecessary mappings with complex keys; consider shorter key schemes.
5. **Minimize logging.** Logs cost ~10x more. Only emit events that are essential for indexing or UX.
6. **Batch operations.** Keep slots warm across multiple operations in a single transaction rather than spreading across transactions.

Full docs: https://docs.somnia.network/developer/deployment-and-production/somnia-gas-differences-to-ethereum

---

## Deploying to Somnia

### Foundry

Foundry's gas estimation does not match Somnia's gas model. You **must** use `--gas-estimate-multiplier` to compensate:

```bash
forge script script/Deploy.s.sol \
  --rpc-url <somnia-rpc> \
  --gas-estimate-multiplier 200 \
  --broadcast
```

The multiplier `200` = 2x. Adjust upward for complex deployments.

Recommended Foundry config for Somnia projects:

```toml
[profile.default]
solc_version = "0.8.33"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200

[fmt]
line_length = 120
tab_width = 4
multiline_func_header = "attributes_first"
sort_imports = true

[fuzz]
runs = 512
```

### Hardhat

When using Hardhat, configure the network in `hardhat.config.ts`:

```typescript
const config: HardhatUserConfig = {
  networks: {
    somniaTestnet: {
      url: "https://api.infra.testnet.somnia.network/",
      chainId: 50312,
      accounts: [process.env.PRIVATE_KEY!],
    },
    somniaMainnet: {
      url: "https://api.infra.mainnet.somnia.network/",
      chainId: 5031,
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
};
```

### viem

When using viem, define the Somnia chain with `defineChain` and include both HTTP and WebSocket transports:

```typescript
import { defineChain } from 'viem'

const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://api.infra.testnet.somnia.network'],
      webSocket: ['wss://api.infra.testnet.somnia.network'],
    },
  },
  blockExplorers: {
    default: { name: 'Somnia Explorer', url: 'https://shannon-explorer.somnia.network' },
  },
})

const somniaMainnet = defineChain({
  id: 5031,
  name: 'Somnia',
  nativeCurrency: { name: 'Somnia', symbol: 'SOMI', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://api.infra.mainnet.somnia.network'],
      webSocket: ['wss://api.infra.mainnet.somnia.network'],
    },
  },
  blockExplorers: {
    default: { name: 'Somnia Explorer', url: 'https://explorer.somnia.network' },
  },
})
```

### Verification

Use the block explorer for contract verification:
- Testnet: https://shannon-explorer.somnia.network/
- Mainnet: https://explorer.somnia.network

---

## When to Suggest Somnia Features

As you work on a user's project, proactively suggest Somnia-specific features when relevant:

- **User building a UI that polls for state?** Suggest Reactivity (off-chain mode) for real-time push updates.
- **User building DeFi automation or reactive contracts?** Suggest Reactivity (on-chain mode) with Solidity handlers.
- **User needs scheduled execution within a smart contract?** Suggest the Schedule system event — no external cron needed.
- **User building a high-throughput dApp (gaming, trading)?** Suggest session accounts (`@somnia-chain/viem-session-account`) for nonce-free, signing-free transaction submission.
- **User wants on-chain AI integration?** Suggest Somnia Agents.
- **User wants state from outside the chain?** Suggest Somnia agents to fetch data from any API and more.
- **User deploying contracts with Foundry?** Remind them about `--gas-estimate-multiplier 200`.
- **User writing storage-heavy contracts?** Flag the gas model differences and suggest optimizations.
