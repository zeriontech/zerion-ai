---
name: lido-stake
description: >
  Stake ETH directly with Lido to receive stETH or wstETH while preserving a
  confirmed partner referral address, then sign through the selected Zerion
  wallet using zerion bundle and verify the position. Use when a user asks to
  stake ETH with Lido in a Zerion workflow.
license: MIT
---

# Lido Direct Staking + Zerion Wallet Signing

**Purpose:** Fund and inspect an Ethereum wallet with Zerion CLI, prepare a referral-attributed Lido staking call, sign it through the same Zerion wallet, and verify the resulting stETH or wstETH position.

## Key Commands

- `zerion wallet list` — list Zerion wallets and their EVM addresses
- `zerion portfolio <address>` — check ETH balance before staking and the updated portfolio afterward
- `zerion positions <address> --defi` — verify the Lido position
- `zerion history <address> --chain ethereum --limit 10` — confirm the staking transaction
- `zerion bridge <from-chain> ETH <amount> ethereum ETH --cheapest --prepare` — prepare Ethereum funding without signing or broadcasting
- `sdk.stake.stakeEthPopulateTx(...)` / `sdk.wrap.wrapEthPopulateTx(...)` — prepare a direct staking call without signing
- `zerion bundle --group "$(cat lido-stake.json)"` — let the selected Zerion wallet sign and execute it

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

### Maintainer referral configuration (pending before release)

The referral is partner configuration, not an end-user input. Lido and Zerion must confirm which address to credit and set the single `ZERION_LIDO_REFERRAL_ADDRESS` constant below before release. Reuse an existing Analytics mapping only after Zerion confirms it is the right identity for the CLI integration. The partner supplies/confirms the address; Lido does not automatically assign one.

This draft still has a maintainer placeholder. Do not release it until the confirmed default has been inserted and checked in both calldata paths. Do not ask end users to obtain the referral, invent one, substitute their wallet, or silently use zero. Referral encoding does not establish rewards-share eligibility.

Local Zerion wallets require their existing agent token and policy permission; read-only wallets use Zerion's owner-signing handoff. See `capabilities/wallet.md` and `capabilities/agent-management.md`. Do not create/import a wallet or export a private key from an agent loop.

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

### 4. Prepare a native transaction for the Zerion wallet

Use the Lido SDK's population methods with a **read-only public client**, then pass the resulting protocol call to `zerion bundle`. Do not create a browser wallet client, export keys or send the user to a separate staking application. This flow stakes native **ETH**. Other tokens require a separately confirmed Zerion swap into ETH first.

Save the following as `prepare-lido-stake.mjs` in the directory where the SDK and Viem were installed. It only reads wallet identity and Ethereum state, simulates, estimates gas and prints a prepared-group JSON. It cannot sign or broadcast.

```javascript
import { execFileSync } from "node:child_process";
import { LidoSDK } from "@lidofinance/lido-ethereum-sdk";
import { createPublicClient, http, isAddress, parseEther, toHex, zeroAddress } from "viem";
import { mainnet } from "viem/chains";

// Maintainer-owned default, confirmed once with Zerion before release.
const ZERION_LIDO_REFERRAL_ADDRESS = "<CONFIRMED_ZERION_REFERRAL_ADDRESS>";
if (!isAddress(ZERION_LIDO_REFERRAL_ADDRESS) ||
    ZERION_LIDO_REFERRAL_ADDRESS.toLowerCase() === zeroAddress) {
  throw new Error("Maintainer referral configuration is incomplete; do not ask end users for a referral");
}
const referralAddress = ZERION_LIDO_REFERRAL_ADDRESS.toLowerCase();
const [walletName, amountInEth, outputToken] = process.argv.slice(2);
if (!walletName || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amountInEth ?? "") ||
    !["stETH", "wstETH"].includes(outputToken)) {
  throw new Error("Usage: node prepare-lido-stake.mjs <wallet-name> <ETH-amount> <stETH|wstETH>");
}
const value = parseEther(amountInEth);
if (value <= 0n) throw new Error("Stake amount must be positive");
const zerion = (...args) => JSON.parse(execFileSync("zerion", args, { encoding: "utf8" }));
const listed = zerion("wallet", "list", "--search", walletName, "--limit", "500");
const matches = listed.wallets.filter(w => w.name === walletName);
if (matches.length !== 1 || !isAddress(matches[0].evmAddress)) {
  throw new Error("Select exactly one existing Zerion EVM wallet by its exact name");
}
const wallet = matches[0];
if (!["local", "read-only"].includes(wallet.type)) throw new Error("Unknown wallet signing type");
const address = wallet.evmAddress.toLowerCase();

// bundle trusts the supplied route. Preserve local-wallet review thresholds.
// Never divert a CLI-created wallet into a different browser wallet.
if (wallet.type === "local" && wallet.reviewThresholdUsd != null) {
  const threshold = wallet.reviewThresholdUsd;
  const positions = zerion("positions", address, "--chain", "ethereum", "--positions", "simple");
  const eth = positions.positions.find(p => p.chain === "ethereum" && p.symbol === "ETH" && p.name === "Ether");
  const usdValue = Number(amountInEth) * eth?.price;
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(usdValue) ||
      !(eth?.price > 0) || usdValue > threshold) {
    throw new Error("Wallet threshold requires owner review; stop and follow Zerion's approval flow. Do not lower the threshold or force local signing");
  }
}

const client = createPublicClient({ chain: mainnet, transport: http(process.env.ETHEREUM_RPC_URL) });
if (await client.getChainId() !== 1) throw new Error("RPC must be Ethereum mainnet");
const sdk = new LidoSDK({ chainId: 1, publicClient: client });
const { isStakingPaused, isStakingLimitSet, currentStakeLimit } = await sdk.stake.getStakeLimitInfo();
if (isStakingPaused) throw new Error("Lido staking is paused");
if (isStakingLimitSet && value > currentStakeLimit) throw new Error("Amount exceeds current staking limit");
const props = { value, referralAddress, account: address };
const tx = outputToken === "wstETH"
  ? await sdk.wrap.wrapEthPopulateTx(props)
  : await sdk.stake.stakeEthPopulateTx(props);
const expectedTo = outputToken === "wstETH"
  ? "0xa88f0329c2c4ce51ba3fc619bbf44efe7120dd0d"
  : "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
if (tx.to.toLowerCase() !== expectedTo || tx.from.toLowerCase() !== address || tx.value !== value) {
  throw new Error("Unexpected Lido transaction target, sender or value");
}
const call = { account: address, to: tx.to, data: tx.data, value };
await client.call(call); // eth_call simulation from the selected signer
const gas = (await client.estimateGas(call) * 120n + 99n) / 100n;
const fees = await client.estimateFeesPerGas();
if (fees.maxFeePerGas == null) throw new Error("Cannot estimate mainnet gas fees");
if (await client.getBalance({ address }) < value + gas * fees.maxFeePerGas) {
  throw new Error("Insufficient ETH for stake plus estimated gas reserve");
}
const group = {
  kind: "zerion-prepared-group", version: 1, ecosystem: "evm", chain: "ethereum",
  address, walletName, route: wallet.type === "local" ? "local" : "web-app",
  summary: { lidoStake: { amountInEth, outputToken, referralAddress,
    estimatedGas: gas.toString(), maxGasCostWei: (gas * fees.maxFeePerGas).toString() } },
  outflows: [{ chain: "ethereum", symbol: "ETH", native: true, amount: amountInEth }],
  preparedAt: new Date().toISOString(),
  transactions: [{ label: `Stake ${amountInEth} ETH with Lido for ${outputToken}`, evm: {
    type: "0x2", from: address, to: expectedTo, chainId: "0x1",
    value: toHex(value), data: tx.data, gas: toHex(gas),
    gasPrice: null, maxFee: null, maxPriorityFee: null, customData: null,
  } }],
};
console.log(JSON.stringify(group));
```

```bash
node prepare-lido-stake.mjs <wallet-name> <ETH-amount> stETH > lido-stake.json
# Or select wstETH instead:
node prepare-lido-stake.mjs <wallet-name> <ETH-amount> wstETH > lido-stake.json
```

Run the chosen output command once. On a preparation failure, stop; never pass an empty or old file to `bundle`. Inspect the complete JSON before execution. The stETH call is `submit(referral)` on Lido; the wstETH call is `stakeETH(referral)` on the immutable referral helper. Neither is a DEX swap, approval or bare ETH transfer. An optional `ETHEREUM_RPC_URL` must point to mainnet.

### 5. Confirm, then sign through Zerion

Show the exact signer, network, ETH amount, output token, target contract, referral and gas estimate, and obtain explicit user confirmation. Re-run preparation immediately before execution, recheck wallet identity/review threshold, and confirm any changed terms. Never manually change the JSON's signer or route.

```bash
zerion bundle --group "$(cat lido-stake.json)"
```

For a local Zerion wallet, `bundle` signs with its existing agent token/OWS keystore, rechecks active policies and aggregate balance, and assigns current fees and nonce. Follow `capabilities/agent-management.md`; humans provision wallet/agent credentials outside the agent loop. A read-only wallet uses Zerion's supported handoff to its owner's external signer. No private key leaves Zerion, and no injected browser wallet is needed for a local wallet. Never bypass a policy denial or lower a review threshold to make execution work.

Read both top-level and per-group `status`, hashes and errors: execution outcomes can exit zero even when failed or rejected. If a hash exists but confirmation times out, check the receipt before another staking attempt.

### 6. Verify attribution and the resulting position

After confirmation, record the transaction hash and inspect the wallet again:

```bash
zerion history <wallet-address> --chain ethereum --limit 10
zerion positions <wallet-address> --chain ethereum
zerion positions <wallet-address> --defi
zerion portfolio <wallet-address>
```

Verify all of the following:

- the transaction succeeded on Ethereum
- the call minted stETH or wstETH rather than swapping for it on a DEX
- the transaction calldata contains the configured referral address
- the received token appears in Ethereum holdings or a Lido DeFi position; simple token holdings need not appear in the grouped `--defi` view
- the amount received is consistent with the confirmed transaction result

Indexing can lag block confirmation briefly. If the transaction succeeded but Zerion has not updated, wait for indexing and retry the read-only checks; do not resubmit the stake.

## Attribution Rules

- Preserve Zerion's confirmed partner referral address in every direct stake.
- Direct Lido minting is required when the goal includes Lido Rewards Share attribution. An ETH-to-stETH swap on a DEX does not count as a direct stake.
- Never route through another provider's referral address without clearly telling the user and integration owner.
- Never claim that a stake qualifies for rewards share solely because a referral was included; final eligibility is determined by the applicable Lido program terms.

## Common Blockers

| Issue | Cause | Fix |
|---|---|---|
| Maintainer referral default is not set | Partner configuration is pending | Resolve with the integration owner before release; never ask end users for it |
| Wallet has ETH, but not on Ethereum | Funds are on an L2 or another chain | Quote a Zerion bridge route and obtain confirmation before bridging |
| Stake exceeds `currentStakeLimit` | Lido's sliding-window limit is temporarily constrained | Reduce the amount or wait; do not silently use a DEX when attribution matters |
| User expected wstETH but received stETH | Wrong SDK method or interface route | Prepare `sdk.wrap.wrapEthPopulateTx` / `stakeETH(referral)` and sign via Zerion |
| Position is absent immediately after confirmation | Zerion indexing delay | Recheck history and positions; never submit a duplicate stake automatically |
| Wrong RPC network, simulation reverts or insufficient gas reserve | Preflight failed | Stop and resolve the failure; do not sign |
| Review threshold exceeded or value unavailable | Owner review required | Follow Zerion's approval flow; never lower the threshold or force local signing |
| Agent token missing or policy denial | Zerion signing is not permitted | Follow wallet/agent-management instructions; never export keys or bypass policies |

## References

- [Lido Ethereum SDK](https://github.com/lidofinance/lido-ethereum-sdk)
- [Lido token integration guide](https://docs.lido.fi/guides/lido-tokens-integration-guide/)
- [wstETHReferralStaker](https://docs.lido.fi/contracts/wsteth-staker/)
- [Lido Rewards Share Program](https://research.lido.fi/t/rewards-share-program-committee-updates/11107/2)

## Related Skills

- `capabilities/analyze.md` — portfolio, history, and DeFi-position verification
- `capabilities/trading.md` — bridge ETH to Ethereum when funding is required
- `capabilities/wallet.md` — select the exact wallet and signing type
- `capabilities/agent-management.md` — agent-token and policy permissions
- `capabilities/bundle.md` — protocol envelope and Zerion wallet execution
