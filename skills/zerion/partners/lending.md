# Zerion — Collateralized Lending

**Purpose:** Enable borrowing against crypto collateral on Aave v3 (multi-chain) and Morpho, with Zerion CLI providing portfolio state and position tracking throughout. Covers the full lifecycle: rate research → supply collateral → borrow → health monitoring → repay → withdraw.

## When to use

- "Borrow USDC against my ETH"
- "Take a loan on Aave without selling my tokens"
- "How much can I borrow against my WBTC?"
- "What's the current borrow rate for [token] on [protocol]?"
- "My health factor is low — help me add collateral or repay"
- "Repay my Aave loan"
- "Withdraw my collateral after repaying"
- "Get liquidity without selling"
- Any request to borrow, leverage, take a loan, manage debt, or interact with a lending protocol on-chain

## Key Commands

**Zerion CLI (read-only)**
```bash
zerion portfolio <address>                    # balances across all chains
zerion positions <address> --defi             # lending positions grouped by protocol (loans netted)
zerion analyze <address>                      # full wallet overview
zerion swap <chain> <amount> <from> <to>      # acquire borrow or repay asset
zerion bridge <from-chain> <token> <amount> <to-chain> <token> --cheapest  # move collateral cross-chain
```

**Aave v3 Pool — read**
- `getUserAccountData(address)` → `totalCollateralBase`, `totalDebtBase`, `availableBorrowsBase`, `currentLiquidationThreshold`, `ltv`, `healthFactor`
- `getReserveData(asset)` → `currentLiquidityRate`, `currentVariableBorrowRate`, `liquidationThreshold`, `ltv`, `borrowingEnabled`, `supplyCap`, `debtCeiling`
- `getReservesList()` → all listed assets on that deployment

**Aave v3 Pool — write (unsigned transactions)**
- `supply(asset, amount, onBehalfOf, referralCode)` — deposit collateral
- `borrow(asset, amount, interestRateMode, referralCode, onBehalfOf)` — take loan (mode: 2 = variable, 1 = stable)
- `repay(asset, amount, rateMode, onBehalfOf)` — repay debt
- `withdraw(asset, amount, to)` — reclaim collateral after repayment
- `setUserEMode(categoryId)` — enable efficiency mode for correlated assets

## Requirements

- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- A funded wallet with assets to use as collateral

## Supported protocols and networks

| Protocol | Networks | Notes |
|----------|----------|-------|
| Aave v3 | Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, Scroll, Gnosis | Primary — widest asset and chain coverage |
| Morpho | Ethereum, Base | Peer-to-peer optimizer built on Aave/Compound; often 10–50 bps better rates |
| Compound v3 | Ethereum, Polygon, Base, Arbitrum | USDC-denominated borrowing only; simpler model |
| Spark | Ethereum | MakerDAO fork; competitive DAI/USDS borrow rates |

Default to **Aave v3** unless the user specifies otherwise or a rate comparison clearly favors another protocol.

## Aave v3 Pool contract addresses

| Network | Pool address |
|---------|-------------|
| Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Polygon | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Arbitrum | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Optimism | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Avalanche | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Scroll | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` |
| Gnosis | `0xb50201558B00496A145fE76f7424749556E326D8` |

## Key risk parameters

| Term | Definition |
|------|-----------|
| LTV (Loan-to-Value) | Max borrow as % of collateral value. ETH on Aave Ethereum: 80%. |
| Liquidation threshold | LTV at which the position is liquidated. Always higher than LTV. ETH: 82.5%. |
| Health factor | `(Σ collateral_i × liquidation_threshold_i) / total_debt_USD`. Must stay > 1.0. |
| Variable borrow rate | Tracks pool utilization — rises when demand is high. Default mode. |
| Stable borrow rate | Locked rate at time of borrow. Being deprecated on Aave v3. |
| Liquidation bonus | Extra % the liquidator claims from collateral on liquidation (penalizes borrower). |

**Recommended minimum health factor: 1.5** — leaves a ~33% buffer before liquidation.

## Workflow

### 1. Check current portfolio

```bash
zerion portfolio <address>
zerion positions <address> --defi
```

Note:
- Which tokens the wallet holds and on which chains
- Any existing lending positions: `position_type: "deposit"` (collateral) and `position_type: "loan"` (debt)

If the wallet already has a debt position on the target protocol, jump straight to **Add Collateral** (step 7), **Repay** (step 8), or **Withdraw** (step 10).

### 2. Identify collateral and borrow intent

Ask the user (or infer from context):
1. Collateral asset (e.g., ETH, WBTC, stETH)
2. Asset to borrow (e.g., USDC, DAI, ETH)
3. Chain and protocol (default: Aave v3 on the chain where collateral sits)
4. How much to borrow — or whether to calculate the safe maximum

### 3. Fetch live rates and parameters

Call `getReserveData(asset)` on the Pool for both the collateral asset and the borrow asset, or query the Aave v3 API:

```
GET https://aave-api-v3.aave.com/data/markets?chainId=<chainId>
```

Surface a comparison table:

| Field | Collateral asset | Borrow asset |
|-------|-----------------|--------------|
| Supply APY | `liquidityRate` (annualized) | — |
| Variable borrow APY | — | `variableBorrowRate` |
| LTV | `ltv` (e.g., 8000 = 80%) | — |
| Liquidation threshold | `liquidationThreshold` | — |
| Liquidation bonus | `liquidationBonus` | — |
| Borrowing enabled | — | `borrowingEnabled` |
| Supply cap remaining | `supplyCap − totalAToken` | — |

If the user hasn't chosen a protocol, include a second table comparing Aave v3 vs Morpho vs Compound for the same pair.

### 4. Calculate safe borrow amount

Given:
- Collateral USD value: `C`
- Collateral liquidation threshold: `LT` (e.g., 0.825)
- Target health factor: `HF` (recommend ≥ 1.5)

```
max_borrow_USD = (C × LT) / HF
```

**Example:** 10 ETH @ $2,000 = $20,000 collateral, LT = 82.5%, target HF = 1.5
```
max_borrow_USD = (20,000 × 0.825) / 1.5 = $11,000
```

Show this calculation explicitly. If the user requested more than the safe maximum, warn them and recommend the calculated amount. Do not build transactions without explicit user confirmation of the amount.

### 5. Supply collateral

Check ERC-20 allowance for the Pool address first. If `allowance < amount`, an approval transaction is required before supply.

Build transactions in order:

**Step A — Approve (if needed):**
```solidity
ERC20(asset).approve(poolAddress, amount)
```

**Step B — Supply:**
```solidity
Pool.supply(
  asset,        // collateral token address
  amount,       // in token's smallest unit (check decimals: USDC=6, WETH/ETH=18)
  onBehalfOf,   // user's wallet address
  0             // referralCode
)
```

Present both decoded calls. Do not sign or broadcast without user approval.

### 6. Borrow

After collateral confirms on-chain — verify with `getUserAccountData` or:

```bash
zerion positions <address> --defi
```

Build the borrow transaction:

```solidity
Pool.borrow(
  asset,             // token to borrow
  amount,            // in token's smallest unit
  2,                 // interestRateMode: 2 = variable (default), 1 = stable
  0,                 // referralCode
  onBehalfOf         // user's wallet address
)
```

Before presenting the transaction, show:
- Projected health factor after borrow
- Ongoing daily cost: `borrow_amount × variable_APY / 365`
- Net position cost: `daily_borrow_cost − daily_supply_yield_on_collateral`

Do not broadcast. Wait for the user to sign and confirm.

### 7. Verify the position

After the borrow transaction confirms:

```bash
zerion positions <address> --defi
```

Confirm and display:
- Collateral amount and USD value
- Debt amount, type (variable/stable), and accruing APY
- Current health factor (from `getUserAccountData`)

### 8. Add collateral (health factor too low or user wants to borrow more)

Trigger: health factor below 1.5, approaching liquidation threshold, or user wants to borrow more.

1. Check available balance: `zerion portfolio <address>`
2. If the wallet lacks additional collateral on the target chain:
   - **Swap**: `zerion swap <chain> <amount> <held-token> <collateral-asset>`
   - **Bridge**: `zerion bridge <from-chain> <token> <amount> <target-chain> <collateral-asset> --cheapest`
3. Build a new `supply` transaction with the additional amount
4. Re-check health factor after confirmation with `getUserAccountData`

### 9. Repay debt

**Step A — Check wallet balance:**
```bash
zerion portfolio <address>
```
If the wallet is short on the borrow asset, acquire it first:
```bash
zerion swap <chain> <needed-amount> <held-token> <borrow-asset>
```

**Step B — Approve the Pool for repayment (if needed):**
```solidity
ERC20(asset).approve(poolAddress, MaxUint256)
```

**Step C — Repay:**
```solidity
Pool.repay(
  asset,          // the borrowed token
  MaxUint256,     // use MaxUint256 to repay full balance including accrued interest
  2,              // rateMode: match the mode used at borrow time
  onBehalfOf      // user's wallet address
)
```

Using `MaxUint256` prevents dust from accrued interest leaving the position open. If the user wants a partial repayment, use the exact amount in base units instead.

### 10. Withdraw collateral

After debt is fully repaid, build the withdrawal:

```solidity
Pool.withdraw(
  asset,       // collateral token
  MaxUint256,  // use MaxUint256 to withdraw everything
  to           // destination address (usually user's wallet)
)
```

Verify the position is fully closed:

```bash
zerion positions <address> --defi
```

## Health factor reference

| Health Factor | Status | Recommended action |
|:---:|---|---|
| > 2.0 | Safe | None |
| 1.5 – 2.0 | Comfortable | Monitor |
| 1.2 – 1.5 | Caution | Add collateral or partially repay |
| 1.0 – 1.2 | Danger | Act immediately |
| < 1.0 | Liquidation | Position is being liquidated |

Always warn the user if any projected action brings health factor below 1.5.

## E-mode (efficiency mode)

Aave v3 E-mode raises LTV significantly for correlated asset pairs. If the user is borrowing a correlated asset, suggest enabling E-mode before supplying collateral.

| E-mode category | Example | LTV | Liquidation threshold |
|----------------|---------|-----|----------------------|
| Stablecoins | USDC → DAI | 97% | 97% |
| ETH-correlated | stETH → ETH | 93% | 95% |
| BTC-correlated | WBTC → cbBTC | 90% | 93% |

To enable (call before or alongside supply):
```solidity
Pool.setUserEMode(categoryId)  // 0 = off, 1 = stablecoins, 2 = ETH-correlated, 3 = BTC-correlated
```

Note: E-mode restricts all borrowing to assets within that category — the user cannot borrow stablecoins and ETH simultaneously while in ETH-correlated mode.

## Common Blockers

- **Asset not listed on target chain:** Not all assets are available on every Aave deployment. Call `getReservesList()` on the Pool or check the Aave UI to confirm availability before building transactions.
- **Borrowing disabled for asset:** Some reserves are supply-only (e.g., certain LP tokens, assets in isolation mode). Check `borrowingEnabled` in `getReserveData`. Suggest an alternative borrow asset.
- **Isolation mode:** An asset with `debtCeiling > 0` can only be used as the sole collateral. If the user already has other collateral, they cannot add an isolated asset to the same position.
- **Supply cap reached:** Some assets have hard deposit caps. Check `supplyCap` against current `totalAToken`. If capped, suggest a different protocol (Morpho, Compound) or a different collateral asset.
- **Health factor would drop below 1.2 after borrow:** Block the transaction and recalculate the safe maximum. Do not proceed without user re-confirmation.
- **Approval needed before supply or repay:** Always check allowance first. Build the approval transaction before the main action or combine with `permit` if the token supports EIP-2612.
- **Stable rate unavailable:** Aave is deprecating stable-rate borrowing across v3 deployments. If `stableBorrowRateEnabled: false`, default to variable and note the change.
- **Wallet on wrong chain:** If collateral is on a different chain than the target protocol, use `zerion bridge` to move assets first before building any lending transaction.
- **Dust debt remaining after repay:** Accrued interest between repay signing and on-chain execution can leave a tiny balance. Using `MaxUint256` as the repay amount avoids this entirely.

## Related Skills

- **zerion-analyze** — inspect existing lending positions and net portfolio health before and after
- **zerion-trading** — swap or bridge to acquire collateral or the asset needed for repayment
- **zerion-vaultsfyi-deposit** — deploy borrowed proceeds or idle collateral into a yield vault
- **zerion-vaultsfyi-yield-optimizer** — find the best yield for collateral assets before supplying to a lending protocol
- **zerion-vaultsfyi-risk-monitor** — ongoing monitoring of position health and liquidation risk
