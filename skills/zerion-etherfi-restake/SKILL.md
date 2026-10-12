---
name: zerion-etherfi-restake
description: >
  Get ETH into ether.fi restaking (weETH) with the Zerion CLI: check the wallet with `zerion portfolio`,
  swap ETH → weETH on the same chain with `zerion swap`, or bridge+swap from another chain with
  `zerion bridge`, then confirm the weETH holding and any DeFi positions built on it with `zerion positions`.
  Use when the user asks to "restake ETH", "get weETH", "stake with ether.fi", "move my ETH into ether.fi",
  or "check my weETH / ether.fi position".
license: MIT
allowed-tools: Bash, Read
---

# ether.fi Restaking (weETH)

**Purpose:** Move ETH into ether.fi's liquid restaking token, weETH, and verify the result — entirely with the Zerion CLI. Zerion reads the wallet, routes the swap or bridge, and confirms the position afterward.

weETH is the wrapped, non-rebasing form of ether.fi's eETH. Its value per token grows against ETH instead of the balance changing, so the token count stays fixed while its ETH value accrues. Docs: [etherfi.gitbook.io](https://etherfi.gitbook.io/etherfi).

## Key Commands
- `zerion portfolio <wallet>` — total value and where the ETH sits, per chain
- `zerion positions <wallet> --chain <chain>` — exact balances on one chain
- `zerion swap <chain> <amount> ETH weETH` — same-chain ETH → weETH
- `zerion bridge <from-chain> ETH <amount> <to-chain> weETH --cheapest` — move ETH from another chain and land as weETH
- `zerion positions <wallet> --positions simple` — confirm the weETH token balance
- `zerion positions <wallet> --positions defi` — weETH deployed into protocols (lending, LP, ether.fi vaults)
## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."` (get one at [dashboard.zerion.io](https://dashboard.zerion.io))
- A wallet: `zerion wallet create --name restake` or `zerion wallet import --name restake --evm-key`
- An agent token for swaps/bridges: `zerion agent create-token --name restake-bot --wallet restake` (see **zerion-agent-management**)
- ETH for gas on the chain you swap on

## weETH addresses

From ether.fi's [deployed contracts](https://etherfi.gitbook.io/etherfi/contracts-and-integrations/deployed-contracts) page. Use the address instead of the `weETH` symbol if a swap resolves to the wrong token.

| Chain | weETH |
|---|---|
| ethereum | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` |
| arbitrum | `0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe` |
| base | `0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A` |
| optimism | `0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF` |
| linea | `0x1Bf74C010E6320bab11e2e5A532b5AC15e0b8aA6` |
| scroll | `0x01f0a31698c4d065659b9bdc21b3610292a1c506` |

eETH exists only on Ethereum. weETH on other chains is bridged and backed 1:1 by mainnet weETH. Run `zerion search weETH` to list every chain where Zerion indexes it.

## Workflow

### 1. Check the wallet

```bash
zerion portfolio restake --pretty
zerion positions restake --positions simple --pretty
```

Note which chain holds the ETH and whether any weETH is already there. If the wallet is empty, fund it first:

```bash
zerion wallet fund --wallet restake
```

### 2a. ETH already on a weETH chain → swap

Swap on the chain where the ETH is. Leave some ETH behind for gas.

```bash
# Ethereum mainnet
zerion swap ethereum 0.5 ETH weETH --wallet restake

# L2s: cheaper gas, same token
zerion swap base 0.5 ETH weETH --wallet restake
zerion swap arbitrum 0.5 ETH weETH --wallet restake
```

If symbol resolution picks the wrong token, pass the contract address from the table:

```bash
zerion swap base 0.5 ETH 0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A --wallet restake
```

### 2b. ETH on another chain → bridge into weETH

`zerion bridge` handles bridge + swap in one step, so the ETH arrives as weETH. When more than one provider quotes the route, the command lists the quotes and exits without executing, so always pass `--cheapest` (highest output) or `--fast` (lowest time):

```bash
# ETH on Optimism → weETH on Arbitrum
zerion bridge optimism ETH 0.5 arbitrum weETH --wallet restake --cheapest

# ETH on Base → weETH on Ethereum mainnet
zerion bridge base ETH 0.5 ethereum weETH --wallet restake --cheapest
```

The command waits for delivery and reports `Bridge delivery confirmed: +<amount> weETH on <chain>`. Leave ETH on the destination chain for gas if you plan to use the weETH there later.

### 3. Confirm the position

```bash
# weETH is a wallet token, so it appears under simple positions, not DeFi
zerion positions restake --positions simple --chain arbitrum --pretty

# DeFi positions show weETH you've put to work (Aave collateral, Pendle, LPs, vaults)
zerion positions restake --positions defi --pretty

# Full picture
zerion analyze restake --pretty
```

A plain weETH balance will **not** appear under `--positions defi`. That filter is empty until weETH is deposited into a protocol. Use `--positions simple` or `--positions all` to confirm the swap landed.

### 4. If the weETH went into an ether.fi vault (e.g. via Zerion Earn)

The weETH leaves the wallet, so it disappears from `--positions simple`. Confirm the deposit through the **vault share token** instead:

```bash
# The vault's share token lands as a wallet token (e.g. liquidETH for ether.fi Liquid ETH)
zerion positions restake --positions simple --chain ethereum

# The deposit itself shows under DeFi, valued in the vault's base asset: WETH, not weETH
zerion positions restake --positions defi --chain ethereum
```

Two things to know when reading the DeFi list:
- **It shows WETH, not weETH.** ether.fi Liquid ETH values deposits in WETH. `zerion positions` doesn't output the protocol name, so the matching WETH row can't be told apart from other WETH DeFi positions by name. Pair it with the share token, whose value should be about the same.
- **The same deposit can be listed twice.** Zerion attributes it to both ether.fi and Veda (Veda runs ether.fi's vaults), so two identical WETH rows appear. Count it once when summing DeFi value.

## Common Blockers
- **`--positions defi` is empty after the swap.** Expected: weETH held in the wallet is a token, not a protocol position. Check `--positions simple`.
- **Vault deposit shows as WETH, not weETH.** ether.fi vault positions are valued in the vault's base asset. Confirm via the share token (e.g. liquidETH) under `--positions simple`.
- **Bridge prints quotes but doesn't execute.** Several providers quoted the route. Re-run with `--cheapest` or `--fast`.
- **`insufficient_funds`.** The swap amount plus gas is more than the ETH balance. Reduce the amount and keep a gas buffer.
- **No route / quote failed.** Liquidity varies by chain. Try Ethereum, Arbitrum or Base, or bridge to one of those.
- **Slippage on large size.** Weigh the swap quote against ether.fi's native mint. Pass `--slippage 0.5` to tighten it, or mint directly at [app.ether.fi](https://app.ether.fi) for large ETH amounts on mainnet.
- **Swap/bridge rejected by policy.** The agent token's policy may not allow the chain or the weETH contract. See **zerion-agent-management**.
- **Exiting.** `zerion swap <chain> <amount> weETH ETH` sells back through DEX liquidity. Native unstaking goes through ether.fi's withdrawal queue in their app.

## Related Skills
- **zerion-analyze** — portfolio, positions and PnL for the wallet
- **zerion-trading** — full swap / bridge / send reference
- **zerion-agent-management** — agent tokens and policies required for swaps
- **zerion-trails-deposit** — deposit into DeFi vaults after acquiring weETH
