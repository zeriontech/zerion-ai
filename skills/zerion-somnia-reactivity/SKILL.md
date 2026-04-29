---
name: somnia-reactivity
description: Deep-dive reference for Somnia Reactivity — the native event-driven pub/sub system. Covers off-chain WebSocket subscriptions, on-chain Solidity handlers, subscription creation from both TypeScript and Solidity, gas configuration, system events (BlockTick/Schedule), and troubleshooting. Use when the user is building reactive dApps, creating subscriptions, writing handler contracts, or debugging reactivity issues.
---

# Somnia Reactivity

You are an expert on Somnia Reactivity — the event-driven execution model built into the Somnia blockchain. You help developers build reactive dApps using both off-chain (TypeScript/WebSocket) and on-chain (Solidity handler) subscriptions.

> **Related skill:** For broader Somnia chain knowledge (gas model, deployment with Foundry/Hardhat, Session RPCs with `@somnia-chain/viem-session-account`, Agents), see the `somnia-blockchain` skill. This skill is the detailed Reactivity reference that supplements the Reactivity overview in `somnia-blockchain`.

## Network

Reactivity is currently only available on **Somnia Testnet**.

| Property | Value |
|---|---|
| Chain ID | `50312` |
| RPC (HTTP) | `https://api.infra.testnet.somnia.network` |
| RPC (WebSocket) | `wss://api.infra.testnet.somnia.network` |
| Block Explorer | `https://shannon-explorer.somnia.network` |
| Native Token | STT (Somnia Testnet Token), 18 decimals |
| Faucet | `https://testnet.somnia.network` |
| Min Balance for On-Chain Subs | 32 STT |

```typescript
import { defineChain } from 'viem'

const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://api.infra.testnet.somnia.network'],
      webSocket: ['wss://api.infra.testnet.somnia.network']
    }
  },
  blockExplorers: {
    default: { name: 'Somnia Explorer', url: 'https://shannon-explorer.somnia.network' }
  }
})
```

---

## What is Reactivity

Reactivity is Somnia's pub/sub system baked into the blockchain. When a smart contract emits an event, validators detect it, bundle the event with related contract state (read at the same block height), and deliver the payload to subscribers. Execution of on-chain handlers happens in a **subsequent block**, not the same block as the event.

Key distinction: state reads are from the event's block (consistent snapshot), but handler execution occurs in the next block(s).

### Core Concepts

- **Events**: Triggers from smart contracts (Transfer, Approval, custom events)
- **State**: View calls fetched at the event's block height for consistency
- **Push Delivery**: Validators handle notifications — no polling needed
- **Subscribers**: Off-chain apps (TypeScript via WebSocket) or on-chain contracts (Solidity handlers)

---

## Off-Chain Subscriptions (TypeScript)

Off-chain subscriptions use WebSockets for real-time event + state delivery to JavaScript/TypeScript applications.

### Setup

```bash
npm i @somnia-chain/reactivity viem
```

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { SDK } from '@somnia-chain/reactivity'

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http()
})

// Optional: Wallet client for on-chain writes
const walletClient = createWalletClient({
  account,
  chain: somniaTestnet,
  transport: http()
})

const sdk = new SDK({
  public: publicClient,
  wallet: walletClient // omit if not executing on-chain transactions
})
```

#### Using a Session Account (High-Throughput)

For applications that create or manage many subscriptions rapidly, use a session wallet client instead of a private key EOA. Session accounts eliminate nonce management and signing overhead.

```bash
npm i @somnia-chain/viem-session-account
```

```typescript
import { createPublicClient, http } from 'viem'
import { createSessionClient, somniaTestnet } from '@somnia-chain/viem-session-account'
import { SDK } from '@somnia-chain/reactivity'

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(),
})

// Session client replaces the standard walletClient
const sessionClient = await createSessionClient({
  seed,                    // cryptographically secure hex string
  chain: somniaTestnet,
  transport: http(),
})

const sdk = new SDK({
  public: publicClient,
  wallet: sessionClient,   // works as a drop-in replacement
})

// All SDK write operations now use session RPCs
await sdk.createSoliditySubscription({ ... })
```

> **Seed security:** The session seed is equivalent to a private key. Generate it with `toHex(randomBytes(32))` (Node.js) or `toHex(crypto.getRandomValues(new Uint8Array(32)))` (browser). See the `somnia-blockchain` skill for full session account setup.

### Creating a WebSocket Subscription

```typescript
import { SDK, SubscriptionCallback } from '@somnia-chain/reactivity'

const subscription = await sdk.subscribe({
  ethCalls: [],
  onData: (data: SubscriptionCallback) => {
    console.log('Event topics:', data.result.topics)
    console.log('Event data:', data.result.data)
    console.log('State reads:', data.result.simulationResults)
  },
  onError: (error: Error) => console.error('Subscription error:', error),
  eventContractSources: ['0xContractAddress'],
  topicOverrides: ['0xEventSignatureHash'],
  onlyPushChanges: false
})

// Clean up when done
subscription.unsubscribe()
```

### WebSocket Subscription Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ethCalls` | `EthCall[]` | Yes | State reads to bundle with events (can be empty `[]`) |
| `onData` | `function` | Yes | Callback for received notifications |
| `onError` | `function` | No | Callback for errors |
| `eventContractSources` | `Address[]` | No | Filter to specific contract addresses |
| `topicOverrides` | `Hex[]` | No | Filter to specific event signatures |
| `onlyPushChanges` | `boolean` | No | Only push if state changed from previous |
| `context` | `string` | No | Event data selectors for ETH call parameters |

### Off-Chain Subscription Lifecycle

- Subscriptions are tied to the WebSocket connection lifetime
- When the connection closes, subscriptions are automatically cleaned up
- Subscription IDs are NOT persistent — don't store them for reuse
- Call `subscription.unsubscribe()` before disconnecting for clean shutdown
- "Too many subscriptions" error = stale WebSocket connections; restart your process

---

## On-Chain Subscriptions (Solidity Handlers)

On-chain subscriptions allow smart contracts to react to events from other contracts. Validators execute handler contracts when subscribed events are emitted.

> **Somnia gas note:** Somnia's gas model differs from Ethereum — cold storage reads are ~476x more expensive and LOG opcodes ~13x more expensive. Keep handler logic minimal: cache storage values in memory, minimize event emissions, and avoid deep call chains. See the `somnia-blockchain` skill for the full gas model reference.

### Step 1: Create the Handler Contract

```bash
npm i @somnia-chain/reactivity-contracts
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    SomniaEventHandler
} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";

/// @title TransferReactor
/// @notice Reacts to Transfer events from a monitored ERC-20 contract and tracks large transfers.
/// @dev Inherits SomniaEventHandler; only the reactivity precompile (0x0100) can call onEvent.
///      Somnia gas: keep handler logic light — cold SLOAD costs ~1M gas, LOG costs ~13x Ethereum.
contract TransferReactor is SomniaEventHandler {
    /// @notice Emitted after the handler processes a Transfer event.
    /// @param from The sender of the original transfer.
    /// @param to The recipient of the original transfer.
    /// @param value The amount transferred.
    event TransferReacted(address indexed from, address indexed to, uint256 value);

    /// @notice Thrown when the emitter is not the expected monitored contract.
    /// @param emitter The address that emitted the event.
    error UnexpectedEmitter(address emitter);

    /// @notice The ERC-20 contract whose Transfer events this handler monitors.
    address public immutable monitoredToken;

    /// @notice Running total of transfer volume processed by this handler.
    uint256 public totalVolumeProcessed;

    /// @param _monitoredToken Address of the ERC-20 token to monitor.
    constructor(address _monitoredToken) {
        monitoredToken = _monitoredToken;
    }

    /// @inheritdoc SomniaEventHandler
    /// @notice Processes incoming Transfer events from the monitored token.
    /// @dev Decodes Transfer(address,address,uint256) event data and updates volume tracking.
    ///      WARNING: Avoid emitting events that match your own subscription filter — infinite loop risk.
    /// @dev Reverts with `UnexpectedEmitter` if the emitting contract is not the monitored token.
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (emitter != monitoredToken) revert UnexpectedEmitter(emitter);

        address from = address(uint160(uint256(eventTopics[1])));
        address to = address(uint160(uint256(eventTopics[2])));
        uint256 value = abi.decode(data, (uint256));

        totalVolumeProcessed += value;
        emit TransferReacted(from, to, value);
    }
}
```

Deploy using Hardhat or Foundry, note the deployed address.

### Step 2: Create the Subscription

Two ways: **TypeScript SDK** or **Solidity precompile**.

#### Option A: TypeScript SDK

```typescript
import { SDK } from '@somnia-chain/reactivity'
import { parseGwei, keccak256, toBytes } from 'viem'

const sdk = new SDK({ public: publicClient, wallet: walletClient })

await sdk.createSoliditySubscription({
  handlerContractAddress: '0xYourHandlerAddress',
  emitter: '0xContractEmittingEvents',
  eventTopics: [keccak256(toBytes('Transfer(address,address,uint256)'))],
  priorityFeePerGas: parseGwei('2'),
  maxFeePerGas: parseGwei('10'),
  gasLimit: 500_000n,
  isGuaranteed: true,
  isCoalesced: false
})
```

#### Option B: Solidity Precompile

Contracts can self-subscribe by calling the reactivity precompile at `0x0100`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    SomniaEventHandler
} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {
    ISomniaReactivityPrecompile,
    SomniaExtensions
} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";

/// @title SelfSubscribingHandler
/// @notice A handler that creates and manages its own reactivity subscription on-chain.
/// @dev The deployer (owner) must hold >= 32 STT for the subscription to remain active.
///      Calls the Somnia Reactivity Precompile at 0x0100 to subscribe/unsubscribe.
contract SelfSubscribingHandler is SomniaEventHandler {
    /// @notice Emitted when a reactivity callback is processed.
    /// @param emitter The contract that emitted the original event.
    /// @param topic0 The first topic (event signature hash).
    event Reacted(address indexed emitter, bytes32 indexed topic0);

    /// @notice Thrown when a non-owner address attempts a restricted action.
    error OnlyOwner();

    /// @notice Thrown when attempting to subscribe while a subscription is already active.
    error AlreadySubscribed();

    /// @notice Thrown when attempting to unsubscribe with no active subscription.
    error NotSubscribed();

    /// @dev Reference to the Somnia Reactivity Precompile.
    ISomniaReactivityPrecompile private constant PRECOMPILE =
        ISomniaReactivityPrecompile(SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS);

    /// @notice The address that deployed this contract and controls subscription management.
    address public immutable owner;

    /// @notice The ID of the active subscription, or 0 if none.
    uint256 public subscriptionId;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Creates a wildcard subscription that reacts to all events.
    /// @dev The owner must hold >= 32 STT. Uses 2 gwei priority / 10 gwei max — the recommended minimums.
    /// @dev Reverts with `AlreadySubscribed` if a subscription is already active.
    /// @dev Reverts with `OnlyOwner` if caller is not the deployer.
    function createSubscription() external onlyOwner {
        if (subscriptionId != 0) revert AlreadySubscribed();

        ISomniaReactivityPrecompile.SubscriptionData memory subData =
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: [bytes32(0), bytes32(0), bytes32(0), bytes32(0)],
                origin: address(0),
                caller: address(0),
                emitter: address(0),
                handlerContractAddress: address(this),
                handlerFunctionSelector: this.onEvent.selector,
                priorityFeePerGas: 2_000_000_000,  // 2 gwei
                maxFeePerGas: 10_000_000_000,       // 10 gwei
                gasLimit: 500_000,
                isGuaranteed: true,
                isCoalesced: false
            });

        subscriptionId = PRECOMPILE.subscribe(subData);
    }

    /// @notice Creates a filtered subscription for a specific event from a specific contract.
    /// @param emitterAddr The contract address to monitor for events.
    /// @param eventSigHash The keccak256 hash of the event signature.
    /// @param handlerGasLimit Max gas per handler invocation. 500000 for simple, up to 3000000 for complex.
    /// @dev Reverts with `AlreadySubscribed` if a subscription is already active.
    /// @dev Reverts with `OnlyOwner` if caller is not the deployer.
    function createFilteredSubscription(
        address emitterAddr,
        bytes32 eventSigHash,
        uint64 handlerGasLimit
    ) external onlyOwner {
        if (subscriptionId != 0) revert AlreadySubscribed();

        ISomniaReactivityPrecompile.SubscriptionData memory subData =
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: [eventSigHash, bytes32(0), bytes32(0), bytes32(0)],
                origin: address(0),
                caller: address(0),
                emitter: emitterAddr,
                handlerContractAddress: address(this),
                handlerFunctionSelector: this.onEvent.selector,
                priorityFeePerGas: 2_000_000_000,
                maxFeePerGas: 10_000_000_000,
                gasLimit: handlerGasLimit,
                isGuaranteed: true,
                isCoalesced: false
            });

        subscriptionId = PRECOMPILE.subscribe(subData);
    }

    /// @notice Cancels the active subscription.
    /// @dev Reverts with `NotSubscribed` if no subscription is active.
    /// @dev Reverts with `OnlyOwner` if caller is not the deployer.
    function cancelSubscription() external onlyOwner {
        if (subscriptionId == 0) revert NotSubscribed();
        PRECOMPILE.unsubscribe(subscriptionId);
        subscriptionId = 0;
    }

    /// @inheritdoc SomniaEventHandler
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        emit Reacted(emitter, eventTopics[0]);
    }
}
```

### Precompile Reference

The Somnia Reactivity Precompile lives at `0x0000000000000000000000000000000000000100` (short: `0x0100`).

| Method | Description |
|---|---|
| `subscribe(SubscriptionData)` | Creates subscription, returns `subscriptionId` |
| `unsubscribe(uint256 subscriptionId)` | Cancels subscription (owner only) |
| `getSubscriptionInfo(uint256 subscriptionId)` | Returns `SubscriptionData` and `owner` |

### SubscriptionData Struct (Solidity)

```solidity
struct SubscriptionData {
    bytes32[4] eventTopics;         // Event topic filters (bytes32(0) = wildcard)
    address origin;                 // tx.origin filter (address(0) = wildcard)
    address caller;                 // msg.sender filter (address(0) = wildcard)
    address emitter;                // Event emitter filter (address(0) = wildcard)
    address handlerContractAddress; // Contract with _onEvent to invoke
    bytes4 handlerFunctionSelector; // Usually onEvent.selector
    uint64 priorityFeePerGas;       // Validator tip in wei (use 2 gwei = 2_000_000_000)
    uint64 maxFeePerGas;            // Fee ceiling in wei (use 10 gwei = 10_000_000_000)
    uint64 gasLimit;                // Max gas per invocation
    bool isGuaranteed;              // Retry delivery if block is full
    bool isCoalesced;               // Batch multiple events per block
}
```

### Requirements

- Subscription owner must hold minimum **32 STT** balance
- Handler contract must inherit `SomniaEventHandler` and override `_onEvent`
- Gas parameters must be in **gwei**, not wei

---

## Gas Configuration (Critical)

Gas misconfiguration is the **#1 cause of "reactivity not working"**. Low gas values cause validators to silently skip your subscription — no error, no warning.

### Three Parameters

| Parameter | What It Does | Recommended Minimum |
|---|---|---|
| `priorityFeePerGas` | Validator tip | `parseGwei('2')` = `2_000_000_000` |
| `maxFeePerGas` | Fee ceiling (base + priority) | `parseGwei('10')` = `10_000_000_000` |
| `gasLimit` | Max gas per handler call | `500_000` (simple) to `3_000_000` (complex) |

### By Handler Complexity

| Handler Type | priorityFeePerGas | maxFeePerGas | gasLimit |
|---|---|---|---|
| Simple (state update, emit) | 2 gwei | 10 gwei | `500_000` |
| Medium (cross-contract calls) | 2 gwei | 10 gwei | `1_000_000` |
| Complex (loops, multiple calls) | 3 gwei | 15 gwei | `3_000_000` |

### Most Common Mistake

```typescript
// WRONG — 10n = 10 wei = essentially zero. Validators will ignore this.
priorityFeePerGas: 10n,
maxFeePerGas: 20n,

// CORRECT — 2 gwei = 2,000,000,000 wei. Validators will process this.
priorityFeePerGas: parseGwei('2'),
maxFeePerGas: parseGwei('10'),
```

Always use `parseGwei()` from viem in TypeScript. In Solidity, use the literal value `2_000_000_000` (2 gwei).

---

## System Event Subscriptions (Cron Jobs)

Requires `@somnia-chain/reactivity@0.1.9` or later.

### Block Tick (Every Block or Specific Block)

```typescript
await sdk.createOnchainBlockTickSubscription({
  handlerContractAddress: '0xYourHandler',
  priorityFeePerGas: BigInt(2_000_000_000),
  maxFeePerGas: BigInt(10_000_000_000),
  gasLimit: BigInt(500_000),
  isGuaranteed: true,
  isCoalesced: false
  // blockNumber: BigInt(123456789)  // omit for every block
})
```

### Schedule (One-Time Future Action)

```typescript
await sdk.scheduleOnchainCronJob({
  timestampMs: Date.now() + 60_000,  // 1 minute from now (milliseconds)
  handlerContractAddress: '0xYourHandler',
  priorityFeePerGas: BigInt(2_000_000_000),
  maxFeePerGas: BigInt(10_000_000_000),
  gasLimit: BigInt(500_000),
  isGuaranteed: true,
  isCoalesced: false
})
```

- Timestamp must be at least 12 seconds in the future
- Uses milliseconds
- One-off: subscription auto-deletes after triggering

---

## Troubleshooting

### Handler Not Being Invoked

Check in this order:

1. **Gas parameters too low** — Most common. Verify `priorityFeePerGas >= 2_000_000_000` (2 gwei). Use `sdk.getSubscriptionInfo(id)` to check.
2. **Contract address mismatch** — After redeploying, create a NEW subscription for the new address.
3. **No active subscription** — Deploying the handler alone is not enough; you must also create a subscription.
4. **Insufficient balance** — Owner must hold >= 32 STT.
5. **Invalid SomniaEventHandler implementation** — Must correctly inherit and override `_onEvent`.

### Verifying Reactivity Works

```typescript
const info = await sdk.getSubscriptionInfo(subscriptionId)
// Verify priorityFeePerGas >= 2000000000
```

Look for validator transactions from `0x0000000000000000000000000000000000000100` on the block explorer targeting your handler contract.

### "Too Many Subscriptions" (Off-Chain)

Stale WebSocket connections accumulated on the server:
- Kill your process completely and restart
- Always call `subscription.unsubscribe()` on shutdown
- In React, use `useEffect` cleanup to unsubscribe

### "Block Range Exceeds 1000" (Frontend)

Somnia RPC limits `eth_getLogs` to 1000 blocks per query:
- Use state polling instead of event listeners for reactivity detection
- Limit `queryFilter` block ranges to 500
- Use Reactivity subscriptions instead of manual log queries

---

## State Consistency

- Events and state are bundled from the **same block height** (atomic snapshot)
- Non-coalesced: one notification per event
- Coalesced: batched events, state reflects the latest in batch
- Handler execution occurs in a **subsequent block**, not the event's block

---

## Quick Reference

| Task | Method |
|---|---|
| Install SDK | `npm i @somnia-chain/reactivity viem` |
| Install Solidity contracts | `npm i @somnia-chain/reactivity-contracts` |
| Off-chain subscription | `sdk.subscribe({ ethCalls, onData })` |
| On-chain sub (TypeScript) | `sdk.createSoliditySubscription({ ... })` |
| On-chain sub (Solidity) | `PRECOMPILE.subscribe(subData)` at `0x0100` |
| Block tick subscription | `sdk.createOnchainBlockTickSubscription({ ... })` |
| Scheduled one-off | `sdk.scheduleOnchainCronJob({ ... })` |
| Check subscription | `sdk.getSubscriptionInfo(subscriptionId)` |
| Cancel subscription | `sdk.cancelSoliditySubscription(subscriptionId)` |
| Handler base contract | `SomniaEventHandler` from `@somnia-chain/reactivity-contracts` |
| Precompile address | `0x0000000000000000000000000000000000000100` |
| Min owner balance | 32 STT |
| Min priority fee | 2 gwei = `2_000_000_000` |
| Chain ID | `50312` |
| RPC | `https://api.infra.testnet.somnia.network` |
| WSS | `wss://api.infra.testnet.somnia.network` |
| Explorer | `https://shannon-explorer.somnia.network` |

---

## Response Guidelines

When helping developers with Reactivity:

1. **Always recommend `parseGwei()` for gas values** in TypeScript, or `2_000_000_000` literals in Solidity — never suggest raw small numbers
2. **Clarify timing**: state reads are from the event block, execution is in a subsequent block
3. **Distinguish off-chain vs on-chain**: WebSocket subscriptions are ephemeral; Solidity subscriptions persist on-chain
4. **For "not working" issues**: check gas first (90% of cases), then address mismatch, then subscription existence
5. **For frontend issues**: suggest state polling over event listeners to avoid block range RPC errors
6. **Always mention 32 STT minimum** when discussing on-chain subscriptions
7. **All Solidity must include NatSpec** (`@title`, `@notice`, `@dev`, `@param`, `@return`) and custom errors with `@dev Reverts with` documenting every revert condition
8. **Always include chain details** (RPC URL, chain ID) when providing setup examples
9. **Somnia gas awareness**: remind users that Somnia's gas model makes cold storage, hashing, and logging more expensive — keep handlers lean
