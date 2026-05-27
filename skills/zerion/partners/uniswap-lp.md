
# Uniswap LP Planning with Portfolio Context

**Purpose:** Use Zerion CLI to assess current exposure and PnL before sizing a Uniswap LP position with `/liquidity-planner`, so the agent deploys capital with full portfolio context.

## Key Commands

**Uniswap skill (invoke in agent context):**
- `/liquidity-planner` — plans LP positions and generates Uniswap interface deep links

**Zerion CLI (shell):**
- `zerion positions <address>` — current token and DeFi positions by chain
- `zerion pnl <address>` — profit and loss per wallet and per asset
- `zerion portfolio <address>` — total portfolio value and top holdings
- `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>` — move capital to the target chain for LP deployment

## Requirements

- Uniswap AI skills: `npx skills add Uniswap/uniswap-ai`
- Zerion CLI: `npx -y zerion-cli init -y --browser`
- Zerion API key: `export ZERION_API_KEY="zk_..."`

## Workflow

### 1. Check current positions across all chains
```bash
zerion positions $WALLET
```
Understand what the agent already holds and where, so LP sizing doesn't over-concentrate exposure.

### 2. Review PnL before committing capital
```bash
zerion pnl $WALLET
```
Check unrealized gains and losses per asset. Avoid deploying into a pool with an asset already deep in loss.

### 3. Confirm total portfolio value
```bash
zerion portfolio $WALLET
```
Validate the proportion of total portfolio the intended LP position represents.

### 4. Bridge capital to the target chain if needed
```bash
zerion bridge ethereum ETH 1 base ETH --cheapest
```
Move tokens to the chain where the LP pool lives before planning. Signature: `zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>`.

### 5. Plan the LP position
Invoke the Uniswap skill in your agent context:
```
/liquidity-planner
```
The skill generates the LP position plan and interface deep link based on your inputs (pool, fee tier, range).

## Common Blockers

- **LP size too large relative to portfolio** — re-check `zerion portfolio` and reduce the intended deposit amount
- **Capital on wrong chain** — `zerion positions` shows chain breakdown; bridge first with `zerion bridge` before planning
- **Asset already at a loss** — `zerion pnl` will surface this; consider whether IL risk compounds an existing losing position

## Related Skills

- **zerion-uniswap-x402** — pay x402 HTTP 402 challenges with cross-chain funding via Zerion CLI
