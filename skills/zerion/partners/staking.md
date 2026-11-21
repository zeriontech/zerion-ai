# Zerion — Liquid Staking

**Purpose:** Stake ETH into liquid staking protocols to earn validator yield while keeping a tradeable receipt token (LST). Uses Zerion CLI for portfolio state and position tracking throughout. Covers Lido, Rocket Pool, Frax, and cbETH for liquid staking, and EigenLayer for restaking on top.

## When to use

- "Stake my ETH"
- "Get stETH / rETH / cbETH"
- "Earn staking yield without locking up my ETH"
- "What's the best liquid staking APY right now?"
- "Restake my stETH on EigenLayer"
- "Unstake my stETH and get ETH back"
- "How much staking yield am I earning?"
- Any request to stake, liquid stake, restake, or manage an LST position

## Key Commands

**Zerion CLI (read-only)**
```bash
zerion portfolio <address>                    # balances across all chains
zerion positions <address> --defi             # staking positions grouped by protocol
zerion analyze <address>                      # full wallet overview including LST holdings
zerion swap <chain> <amount> <from> <to>      # swap LST back to ETH if needed
```

**Lido — write (unsigned transactions)**
- `submit(address referral)` payable — stake ETH, receive stETH 1:1
- `requestWithdrawalsETH(uint256[] amounts, address owner)` — queue ETH withdrawal
- `claimWithdrawalsETH(uint256[] requestIds)` — claim after queue clears (~1–5 days)

**Rocket Pool — write**
- `deposit()` payable on `RocketDepositPool` — stake ETH, receive rETH at current exchange rate
- `burn(uint256 rethAmount)` on `RocketTokenRETH` — redeem rETH for ETH (if pool has liquidity)

**Frax — write**
- `submit()` payable on `frxETHMinter` — stake ETH, receive frxETH
- `deposit(uint256 assets, address receiver)` on `sfrxETH` vault — deposit frxETH, receive sfrxETH (yield-bearing)
- `redeem(uint256 shares, address receiver, address owner)` on `sfrxETH` — exit position

**EigenLayer — write (restaking)**
- `depositIntoStrategy(address strategy, address token, uint256 amount)` on `StrategyManager` — restake an LST
- `queueWithdrawals(...)` on `DelegationManager` — initiate restaking withdrawal
- `completeQueuedWithdrawals(...)` — claim after 7-day unbonding period

## Requirements

- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- ETH on Ethereum mainnet as the staking asset

## Supported protocols

| Protocol | Token | APY (approx) | Withdrawal | Notes |
|----------|-------|:---:|---|---|
| Lido | stETH | ~3.8% | 1–5 day queue | Largest TVL; rebasing token (balance updates daily) |
| Rocket Pool | rETH | ~3.5% | Instant via DEX or pool | Decentralized; exchange-rate token |
| Frax | sfrxETH | ~4.2% | Instant redeem | Two-step: ETH → frxETH → sfrxETH |
| Coinbase | cbETH | ~3.2% | Via Coinbase or DEX swap | Centralized; widely accepted as collateral |
| EigenLayer | — | +1–3% on top | 7-day unbonding | Restakes an existing LST for additional yield |

Default to **Lido** unless the user specifies otherwise or a rate comparison favors another protocol.

## Key contract addresses (Ethereum mainnet)

| Contract | Address |
|---|---|
| Lido stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |
| Lido WithdrawalQueue | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` |
| Rocket Pool Deposit | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` |
| Rocket Pool rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` |
| Frax frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` |
| Frax sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` |
| Coinbase cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` |
| EigenLayer StrategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` |
| EigenLayer stETH Strategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` |

## Workflow

### 1. Check current portfolio

```bash
zerion portfolio <address>
zerion positions <address> --defi
```

Note:
- ETH balance available to stake
- Any existing LST holdings (`stETH`, `rETH`, `sfrxETH`, `cbETH`)
- Any active EigenLayer restaking positions

### 2. Compare APYs and choose a protocol

Fetch live APYs from the DeFiLlama yields API:

```
GET https://yields.llama.fi/pools
```

Filter for `project` ∈ `lido`, `rocket-pool`, `frax-ether`, `coinbase-wrapped-staked-eth` on `Ethereum`. Surface:

| Protocol | Token | APY | TVL | Notes |
|---|---|---|---|---|
| Lido | stETH | live | live | Rebasing — balance grows daily |
| Rocket Pool | rETH | live | live | Exchange rate grows over time |
| Frax | sfrxETH | live | live | Highest APY; two-step entry |
| Coinbase | cbETH | live | live | Most liquid; centralized |

If the user hasn't chosen a protocol, present this table and recommend based on their priorities:
- **Simplest**: Lido
- **Most decentralized**: Rocket Pool
- **Highest yield**: Frax sfrxETH
- **Best collateral acceptance**: cbETH or stETH

### 3. Calculate expected yield

Given:
- Stake amount: `A` ETH
- Protocol APY: `r`

```
daily_yield  = A × r / 365
monthly_yield = A × r / 12
annual_yield  = A × r
```

Present this before building any transaction so the user knows what they're signing up for.

### 4a. Stake with Lido

Single transaction — ETH goes in, stETH comes back immediately.

Check allowance is not needed (ETH is native). Build:

```solidity
stETH.submit{value: amount}(address(0))
// referral: address(0) unless user has a referral address
```

- `to`: `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`
- `value`: stake amount in wei
- `data`: `0xa1903eab` + `000...000` (referral = zero address, padded 32 bytes)

After confirmation, the user's wallet will show `stETH` balance equal to the ETH staked. stETH is rebasing — the balance increases daily as rewards accrue.

### 4b. Stake with Rocket Pool

Single transaction — ETH in, rETH out at current exchange rate.

```solidity
RocketDepositPool.deposit{value: amount}()
```

- `to`: `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8`
- `value`: stake amount in wei
- `data`: `0xd0e30db0`

Minimum deposit: 0.01 ETH. If the deposit pool is at capacity, suggest swapping ETH → rETH on a DEX instead (`zerion swap ethereum <amount> ETH rETH`).

### 4c. Stake with Frax (two steps)

**Step A — Mint frxETH:**
```solidity
frxETHMinter.submit{value: amount}()
```
- `to`: `0xbAFA44EFE7901E04E39Dad13167D089C559c1138`
- `value`: amount in wei
- `data`: `0x5f575529`

**Step B — Deposit frxETH into sfrxETH vault:**
```solidity
sfrxETH.deposit(frxETH_amount, receiver)
```
- `to`: `0xac3E018457B222d93114458476f3E3416Abbe38F`
- Approve frxETH to sfrxETH first if allowance is insufficient
- `data`: `0x6e553f65` + encode(amount, receiver)

sfrxETH is exchange-rate based — its value grows relative to frxETH as rewards accrue.

### 5. Verify staking position

After transaction confirms:

```bash
zerion positions <address> --defi
zerion portfolio <address>
```

Confirm the LST token appeared in the wallet. For Lido, check `stETH` balance. For Rocket Pool, check `rETH` balance. For Frax, check `sfrxETH` balance.

### 6. Restake on EigenLayer (optional)

If the user wants additional yield on top of staking rewards, they can restake their LST on EigenLayer.

**Step A — Approve LST to StrategyManager:**
```solidity
ERC20(lstToken).approve(0x858646372CC42E1A627fcE94aa7A7033e7CF075A, amount)
```

**Step B — Deposit into strategy:**
```solidity
StrategyManager.depositIntoStrategy(strategyAddress, lstToken, amount)
```

For stETH, `strategyAddress` = `0x93c4b944D05dfe6df7645A86cd2206016c51564D`.

Note: EigenLayer restaking earns additional points and AVS rewards but adds a **7-day unbonding period** before withdrawal. Surface this tradeoff to the user before proceeding.

### 7. Unstake

#### Lido withdrawal (1–5 days)

**Step A — Request withdrawal:**
```solidity
WithdrawalQueue.requestWithdrawalsETH(amounts, owner)
// amounts: array of uint256 (each ≤ 1000 ETH)
// owner: user's address
```
Approve stETH to WithdrawalQueue first.

**Step B — Claim when ready:**
```solidity
WithdrawalQueue.claimWithdrawalsETH(requestIds)
```
Monitor status with `getWithdrawalStatus(requestIds)` — `isFinalized: true` means claimable.

Alternatively, **swap stETH → ETH instantly** on Curve or a DEX:
```bash
zerion swap ethereum <amount> stETH ETH
```
Small discount (~0.1%) vs waiting for the queue.

#### Rocket Pool (instant or queued)

If the rETH burn pool has liquidity:
```solidity
RocketTokenRETH.burn(rethAmount)
```

If the pool is empty, swap via DEX:
```bash
zerion swap ethereum <amount> rETH ETH
```

#### Frax

```solidity
sfrxETH.redeem(shares, receiver, owner)
```
Converts sfrxETH → frxETH, then swap frxETH → ETH on a DEX if needed.

## Health factor reference (EigenLayer restaking)

| Unbonding status | Notes |
|---|---|
| Active | Restaked LST earning AVS rewards |
| Queued (0–7 days) | Withdrawal initiated, not yet claimable |
| Claimable | `completeQueuedWithdrawals` available |

## Common Blockers

- **No ETH on mainnet:** Zerion shows balance on other chains. Use `zerion bridge` to move ETH to Ethereum mainnet first.
- **Rocket Pool deposit pool at capacity:** Check `getDepositPoolBalance()` vs `getMaximumDepositPoolSize()`. If full, swap ETH → rETH on a DEX via `zerion swap`.
- **Lido withdrawal queue backlog:** Queue times vary from hours to 5+ days depending on validator exit demand. Offer the instant stETH → ETH DEX swap as an alternative.
- **frxETH approval needed before sfrxETH deposit:** Always check allowance first and build the approve transaction before the deposit.
- **EigenLayer 7-day unbonding:** Cannot be bypassed. Surface this prominently before the user decides to restake — their LST is illiquid for 7 days after initiating withdrawal.
- **stETH rebasing incompatibility:** Some DeFi protocols use wstETH (wrapped, non-rebasing stETH) instead of stETH. If the user needs to deposit stETH into another protocol, check whether it requires wstETH and wrap it first via `stETH.wrap(amount)` on the wstETH contract (`0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`).
- **cbETH only available via Coinbase or DEX:** cbETH cannot be minted directly — acquire via `zerion swap ethereum <amount> ETH cbETH`.

## Related Skills

- **zerion-analyze** — inspect current LST holdings and staking positions
- **zerion-trading** — swap LSTs back to ETH or acquire LSTs via DEX
- **zerion-lending** — use LSTs (stETH, rETH) as collateral to borrow against staked position
- **zerion-vaultsfyi-deposit** — deposit LSTs into yield vaults for additional return on top of staking APY
- **zerion-vaultsfyi-yield-optimizer** — compare staking APY against other yield strategies
