---
name: lido-stake
description: >
  Stake ETH directly with Lido to receive stETH or wstETH while preserving a
  configured referral address, then use Zerion CLI to fund, inspect, and verify
  the wallet. Use when a user asks to stake ETH with Lido or add native Lido
  staking to a Zerion workflow.
license: MIT
---

# Lido Direct Staking + Zerion Verification

**Purpose:** Fund and inspect an Ethereum wallet with Zerion CLI, stake ETH directly through Lido with explicit referral attribution, and verify the resulting stETH or wstETH position in Zerion.

## Key Commands

- `zerion wallet list` — list Zerion wallets and their EVM addresses
- `zerion portfolio <address>` — check ETH balance before staking and the updated portfolio afterward
- `zerion positions <address> --defi` — verify the Lido position
- `zerion history <address> --chain ethereum --limit 10` — confirm the staking transaction
- `zerion bridge <from-chain> ETH <amount> ethereum ETH --cheapest --prepare` — prepare Ethereum funding without signing or broadcasting
- `sdk.stake.stakeEth(...)` — mint stETH directly through Lido
- `sdk.wrap.wrapEth(...)` — stake ETH and receive wstETH in one transaction

## Requirements

- Node.js 22.12+ (or 20.19+ on Node 20) and npm 11.10+
- Zerion CLI and API key:

  ```bash
  npm install -g --min-release-age=15 zerion-cli
  export ZERION_API_KEY="zk_..."
  ```

- For a native programmatic integration, the Lido Ethereum SDK and Viem:

  ```bash
  npm install --min-release-age=15 @lidofinance/lido-ethereum-sdk viem
  ```

- A funded Ethereum mainnet wallet with enough ETH for the stake plus gas
- A non-zero referral address assigned to the Zerion integration:

  ```bash
  export LIDO_REFERRAL_ADDRESS="0x..."
  ```

Do not invent, substitute, or silently zero the referral address. If Zerion has not supplied the production referral address, stop before preparing the staking transaction and ask for it.

## Workflow

### 1. Select and inspect the wallet

```bash
zerion wallet list
zerion portfolio <wallet-address>
zerion positions <wallet-address> --defi
```

Confirm with the user:

- the wallet address
- the amount of ETH to stake
- whether they want rebasing `stETH` or non-rebasing `wstETH`
- that the transaction will execute on Ethereum mainnet

Keep enough ETH unstaked to pay gas. Never export or request the wallet's private key for this workflow.

### 2. Fund Ethereum if necessary

If the wallet has ETH on another Zerion-supported chain but not enough on Ethereum, first prepare a bridge route without signing or broadcasting. Show the expected output, fees, destination address, and timing. Use the selected Zerion wallet name and its Ethereum address explicitly; do not rely on a different default wallet. Execute only after the user confirms.

```bash
zerion bridge base ETH 0.5 ethereum ETH --wallet <wallet-name> --to-address <wallet-address> --cheapest --prepare

# After the user chooses a route:
zerion bridge base ETH 0.5 ethereum ETH --wallet <wallet-name> --to-address <wallet-address> --cheapest --review

# Verify arrival on Ethereum:
zerion portfolio <wallet-address>
```

Skip this step when the wallet already has sufficient Ethereum ETH.

The unflagged bridge command can execute automatically when only one offer exists. Always use `--prepare` for the initial inspection. `--review` forces the execution route through human review; the execution command obtains a fresh quote, so check its current terms before signing.

### 3. Show current staking terms

Fetch Lido's live seven-day staking APR rather than hardcoding it:

```bash
curl -s https://eth-api.lido.fi/v1/protocol/steth/apr/sma
```

Before asking for a signature, summarize:

- the live APR and that it can change
- Lido's protocol fee, which is deducted from staking rewards rather than principal
- network gas
- smart-contract and validator/slashing risk
- the selected output token: stETH rebases; wstETH keeps a static balance while its stETH value changes
- Lido protocol withdrawals are asynchronous; exchanging on a secondary market is a separate swap with its own price and fees

### 4A. User-signed route through the Lido staking app

This is the default for an individual user or a read-only Zerion wallet. Provide the referral-bearing URL and let the user connect and sign in their own wallet:

```text
https://stake.lido.fi/?ref=<LIDO_REFERRAL_ADDRESS>
```

Do not replace the referral address with the user's wallet. The `ref` value identifies the integration that sourced the stake.

If the user asks for wstETH specifically, use the native SDK route below or a production interface that calls Lido's `wstETHReferralStaker.stakeETH(referral)` method. Do not send ETH directly to the helper contract.

### 4B. Native integration with the Lido Ethereum SDK

Use this route when implementing staking inside an application. Keep wallet signing in the user's injected wallet; do not place private keys in code or environment variables.

```typescript
import { LidoSDK } from "@lidofinance/lido-ethereum-sdk";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  parseEther,
  zeroAddress,
} from "viem";
import { mainnet } from "viem/chains";

// Load this from Zerion's integration configuration. It is an attribution
// identifier, not the user's wallet address.
const referralAddress = "<ZERION_LIDO_REFERRAL_ADDRESS>" as `0x${string}`;
if (!isAddress(referralAddress) || referralAddress === zeroAddress) {
  throw new Error("A valid non-zero LIDO_REFERRAL_ADDRESS is required");
}

// Match the Ethereum address selected during Zerion wallet inspection.
const expectedWalletAddress = "<SELECTED_ETHEREUM_WALLET_ADDRESS>" as `0x${string}`;
if (!isAddress(expectedWalletAddress)) {
  throw new Error("A valid selected Ethereum wallet address is required");
}

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(
    (window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum,
  ),
});

const [account] = await walletClient.requestAddresses();
if (!account || account.toLowerCase() !== expectedWalletAddress.toLowerCase()) {
  throw new Error("Connected wallet does not match the selected Zerion address");
}
if ((await walletClient.getChainId()) !== mainnet.id) {
  throw new Error("Connect the wallet to Ethereum mainnet before staking");
}
const sdk = new LidoSDK({
  chainId: mainnet.id,
  publicClient,
  walletClient,
});

const amountInEth = "<amount-in-eth>";
const outputToken = "<stETH-or-wstETH>" as "stETH" | "wstETH";
if (outputToken !== "stETH" && outputToken !== "wstETH") {
  throw new Error("Choose stETH or wstETH explicitly");
}
const value = parseEther(amountInEth);
if (value <= 0n) throw new Error("Stake amount must be greater than zero");
const { isStakingPaused, currentStakeLimit } =
  await sdk.stake.getStakeLimitInfo();

if (isStakingPaused) throw new Error("Lido staking is currently paused");
if (value > currentStakeLimit) {
  throw new Error("Amount exceeds Lido's current staking limit");
}

// Call only after displaying the amount, token output, referral address,
// live APR, gas estimate, and risks, and receiving explicit user confirmation.
const result =
  outputToken === "wstETH"
    ? await sdk.wrap.wrapEth({ value, referralAddress, account })
    : await sdk.stake.stakeEth({ value, referralAddress, account });

console.log(result.hash, result.result);
```

Use `sdk.stake.stakeEth` for stETH. Use `sdk.wrap.wrapEth` for a one-transaction ETH-to-wstETH flow through Lido's immutable referral helper.

### 5. Verify attribution and the resulting position

After confirmation, record the transaction hash and inspect the wallet again:

```bash
zerion history <wallet-address> --chain ethereum --limit 10
zerion positions <wallet-address> --defi
zerion portfolio <wallet-address>
```

Verify all of the following:

- the transaction succeeded on Ethereum
- the call minted stETH or wstETH rather than swapping for it on a DEX
- the transaction calldata contains the configured referral address
- the received token appears in the wallet or Lido DeFi position
- the amount received is consistent with the confirmed transaction result

Indexing can lag block confirmation briefly. If the transaction succeeded but Zerion has not updated, wait for indexing and retry the read-only checks; do not resubmit the stake.

## Attribution Rules

- Preserve Zerion's assigned referral address in every direct stake.
- Direct Lido minting is required when the goal includes Lido Rewards Share attribution. An ETH-to-stETH swap on a DEX does not count as a direct stake.
- Never route through another provider's referral address without clearly telling the user and integration owner.
- Never claim that a stake qualifies for rewards share solely because a referral was included; final eligibility is determined by the applicable Lido program terms.

## Common Blockers

| Issue | Cause | Fix |
|---|---|---|
| Referral address is missing or zero | Production attribution has not been configured | Stop and obtain Zerion's assigned referral address |
| Wallet has ETH, but not on Ethereum | Funds are on an L2 or another chain | Quote a Zerion bridge route and obtain confirmation before bridging |
| Stake exceeds `currentStakeLimit` | Lido's sliding-window limit is temporarily constrained | Reduce the amount or wait; do not silently use a DEX when attribution matters |
| User expected wstETH but received stETH | Wrong SDK method or interface route | Use `sdk.wrap.wrapEth` / `stakeETH(referral)` for direct wstETH |
| Position is absent immediately after confirmation | Zerion indexing delay | Recheck history and positions; never submit a duplicate stake automatically |
| Wallet prompts on the wrong network | Provider is not connected to Ethereum mainnet | Switch to chain ID 1 and re-run the preflight before signing |

## References

- [Lido Ethereum SDK](https://github.com/lidofinance/lido-ethereum-sdk)
- [Lido token integration guide](https://docs.lido.fi/guides/lido-tokens-integration-guide/)
- [wstETHReferralStaker](https://docs.lido.fi/contracts/wsteth-staker/)
- [Lido Rewards Share Program](https://research.lido.fi/t/rewards-share-program-committee-updates/11107/2)

## Related Skills

- `capabilities/analyze.md` — portfolio, history, and DeFi-position verification
- `capabilities/trading.md` — bridge ETH to Ethereum when funding is required
- `capabilities/wallet.md` — select or add the wallet before staking
