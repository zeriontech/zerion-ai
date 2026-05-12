---
name: zerion-vaultsfyi-strategist
description: >
  Institutional-grade yield strategy analysis using vaults.fyi historical data, benchmark rate environments, share price trends, and curator track records, paired with Zerion wallet context.
license: MIT
---

# vaults.fyi Strategist

**Purpose:** Run deep strategy analysis using vaults.fyi's historical data and benchmark infrastructure alongside Zerion wallet context to answer questions no other DeFi data source can.

## When to use
- "If I'd been in vault A instead of vault B, how much more would I have earned?"
- "Are rates high right now or should I wait?"
- "Which curator has the best track record?"
- "Compare Gauntlet vs Steakhouse vs RE7 over the last 30 days"
- "Why is this vault's APY so high?"
- "Break down where this vault's yield is coming from"
- Any request for backtesting, rate environment assessment, or curator evaluation

## Key Commands
- `zerion portfolio <address>` — current portfolio for context
- `zerion positions <address>` — existing DeFi positions
- `zerion pnl <address>` — realized P&L for comparison with vault returns
- vaults.fyi MCP: `vault_details` — full vault metadata, score, curator, protocol, fees
- vaults.fyi MCP: `vault_apy_history` — historical APY over configurable windows
- vaults.fyi MCP: `vault_tvl_history` — historical TVL trends
- vaults.fyi MCP: `vault_history` — share price history for precise return calculation
- vaults.fyi MCP: `vault_returns` — realized returns for a specific wallet
- vaults.fyi MCP: `benchmark_apy` — current network benchmark rate
- vaults.fyi MCP: `benchmark_apy_history` — historical benchmark for rate environment analysis
- vaults.fyi MCP: `curators` — list and normalize curator names
- vaults.fyi MCP: `vaults_search` — search by curator, asset, network, protocol

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected

## Workflow

### Backtest: "What if I'd been in vault X instead?"

Compare historical performance of two or more vaults to quantify the difference a decision would have made.

### 1. Gather historical data

For each vault being compared:

- Call `vault_apy_history` for the comparison window (30, 60, or 90 days). Set `fromTimestamp` to the start of the window (e.g. current unix timestamp minus 2592000 for 30 days) — without it, the API returns data from vault creation.
- Call `vault_history` for share price data over the same period. Use the same `fromTimestamp`.
- Call `vault_tvl_history` to understand capital flow context. Use the same `fromTimestamp`.
- Call `vault_details` for current score, fees, and flags.

### 2. Calculate comparative returns

Using share price history (the most accurate method):

- **Period return:** `(end_share_price - start_share_price) / start_share_price`
- **Annualized return:** compound the period return to a yearly figure
- **For a specific amount:** `hypothetical_value = deposit_amount * (end_share_price / start_share_price)`

Account for fees: share price already reflects performance fees on most vaults, but note management fees or withdrawal fees that would apply on exit.

### 3. Add wallet context

If the user provides an address, show their actual returns in the current vault:

```bash
zerion pnl <address>
```

Call vaults.fyi `vault_returns` with the wallet address and vault to get realized return data. Compare actual returns against what the alternative vault would have delivered.

### 4. Present the backtest

| Metric | Current Vault | Alternative Vault |
|--------|--------------|-------------------|
| Period return | | |
| Annualized return | | |
| Hypothetical value on $10,000 | | |
| APY stability (high/low range) | | |
| TVL trend | | |
| Score | | |
| Fees | | |

State the dollar difference clearly: "Over the last 30 days, vault B would have earned $X more on a $10,000 position."

---

### Rate Environment: "Are rates high or low right now?"

Use benchmark infrastructure to characterize the current yield market and identify anomalies.

### 1. Build the benchmark picture

For target networks (default: mainnet, Base, Arbitrum, Optimism):

- Call `benchmark_apy` with `code: "usd"` and `code: "eth"` for current rates.
- Call `benchmark_apy_history` for 30-day and 90-day windows.

### 2. Classify the environment

For each network and benchmark:

- **Elevated:** current rate > 1.5x the 30-day average
- **Compressed:** current rate < 0.7x the 30-day average
- **Normal:** between those bounds
- **Trending:** compare 7-day average vs 30-day average for direction

### 3. Identify what's driving the environment

When rates are elevated:

- Call `vaults_search` sorted by `apy30day` descending to find the top-yielding vaults.
- Check whether high yields are concentrated in a single protocol, curator, or asset — that usually signals an incentive campaign or temporary liquidity event.
- Call `vault_details` on the top yielders to check for reward tokens or incentive flags.

### 4. Make a recommendation

- **Elevated rates:** "Rates are high. Lock in yield now, but be aware this may be incentive-driven and temporary."
- **Compressed rates:** "Rates are low. Consider shorter-duration positions or waiting for better entry points."
- **Normal rates:** "Rates are in line with recent history. Standard deployment criteria apply."

If the user has a wallet, compare their current positions against the environment:

```bash
zerion positions <address>
```

Flag positions that are earning below the compressed benchmark — those are underperforming even in a bad market.

---

### Curator Track Record: "Who should I trust with my capital?"

Evaluate curators by their historical performance, risk management, and vault quality.

### 1. Resolve and compare curators

Call `curators` to normalize names. Then for each curator:

- Call `vaults_search` with `curators: [name]`, `sortBy: "tvl"`, `sortOrder: "desc"` to get all their vaults.
- For each vault, call `vault_apy_history` for 30-day performance.
- Call `vault_details` for score, flags, and fees.

### 2. Build curator scorecards

For each curator, aggregate:

| Metric | Curator A | Curator B | Curator C |
|--------|-----------|-----------|-----------|
| Vaults managed | | | |
| Total TVL | | | |
| TVL-weighted avg APY (30d) | | | |
| Average score | | | |
| Score range (min–max) | | | |
| Active incidents | | | |
| Historical incidents | | | |
| Networks active on | | | |
| Assets managed | | | |
| APY consistency (range over 30d) | | | |

### 3. Verdict

Rank curators on:
1. **Risk management:** incident frequency, score consistency, flag history
2. **Yield delivery:** TVL-weighted APY vs benchmark
3. **Consistency:** APY stability over 30 days
4. **Diversification:** breadth across markets, assets, and networks

If the user holds positions with any of these curators, show their exposure:

```bash
zerion positions <address>
```

## Common Blockers
- **Limited historical data for new vaults:** Vaults launched recently won't have 90-day history. Note the available data window and compare only within it.
- **Benchmark not available for all networks:** Smaller or newer networks may lack benchmark history. Note the gap.
- **Curator comparison across different assets:** Comparing a stablecoin curator to an ETH curator on raw APY is misleading. Group by asset class and compare within groups.
- **Complex deposit/redeem flows affect strategy viability:** When recommending vaults or curators, factor in `transactionalProperties`. A vault with `redeemStepsType: "complex"` (e.g., quarterly settlement, multi-day cooldowns) is less suitable for active rebalancing strategies. A vault with `depositStepsType: "complex"` has higher operational cost to enter. Include flow type in curator and vault assessments.
- **Zerion positions vs vaults.fyi positions:** Zerion shows all DeFi positions (broad coverage, USD values). vaults.fyi adds vault-specific yield intelligence (APY methodology, scores, flags, curator data). When the user provides a wallet for context, use both — Zerion for the portfolio-wide picture, vaults.fyi for the yield analysis layer.

## Related Skills
- **zerion-vaultsfyi-yield-optimizer** — act on strategist findings by identifying rebalance opportunities
- **zerion-vaultsfyi-rebalance** — execute the moves the strategist recommends
- **zerion-vaultsfyi-market-intel** — lighter-weight market overview
- **zerion-analyze** — Zerion's wallet analysis for portfolio context
