---
name: zerion-vaultsfyi-yield-optimizer
description: >
  Audit a Zerion wallet's DeFi positions against vaults.fyi yield data to find where you're leaving yield on the table, surface better alternatives, and identify idle assets that could be earning.
license: MIT
---

# vaults.fyi Yield Optimizer

**Purpose:** Combine Zerion wallet analysis with vaults.fyi yield intelligence to audit positions, quantify opportunity cost, and find higher-yield alternatives for idle or underperforming assets.

## When to use
- "Am I getting the best yield on my positions?"
- "Audit my wallet for yield opportunities"
- "Where am I leaving money on the table?"
- "What should I do with my idle USDC?"
- "Find better vaults for my current positions"
- "Check my portfolio for claimable rewards"
- Any request to optimize, audit, or improve yield on an existing wallet

## Key Commands
- `zerion analyze <address>` — full portfolio snapshot: positions, balances, PnL
- `zerion positions <address>` — detailed token and DeFi positions
- `zerion portfolio <address>` — portfolio value and top holdings
- `zerion chains` — list supported chains
- vaults.fyi MCP: `vaults_search` — find and rank vaults by asset, network, APY, TVL
- vaults.fyi MCP: `positions` — wallet's current vault positions via vaults.fyi
- vaults.fyi MCP: `rewards` — claimable vault rewards
- vaults.fyi MCP: `wallet_balances` — idle (undeployed) token balances
- vaults.fyi MCP: `benchmark_apy` — network-level benchmark rates for USD and ETH
- vaults.fyi MCP: `best_deposit_options` — top vaults for an idle asset

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected (provides yield data, vault search, benchmark rates)

## Workflow

### 1. Get wallet overview from Zerion

Pull the full portfolio to understand what the wallet holds and where it's deployed.

```bash
zerion analyze <address>
```

This gives you positions, balances, transaction history, and PnL in one call. Note which tokens are sitting idle and which are in DeFi positions.

**What Zerion shows vs vaults.fyi:** Zerion gives the broad portfolio picture — every token, every DeFi position, USD values, PnL. It covers protocols beyond vaults (DEX LPs, staking, lending positions). Use it to understand the full wallet. vaults.fyi adds yield-specific intelligence on top: APY with methodology, risk scores, curator attribution, flags, and benchmark context. They complement each other — Zerion for "what do I have," vaults.fyi for "how is it performing and what should I do about it."

### 2. Pull vault positions and idle balances from vaults.fyi

Call the vaults.fyi MCP tools to get the yield intelligence layer:

- Call `positions` with the wallet address to get current vault positions with APY, score, flags, and curator data. This overlaps with Zerion's position data on vault values but adds yield metrics, risk scoring, and curator context that Zerion doesn't provide.
- Call `wallet_balances` for the same address to find idle tokens not deployed in any vault.
- Call `rewards` to surface any claimable vault rewards.

### 3. Check benchmark rates

For each network where the wallet has positions, call `benchmark_apy` with `code: "usd"` (for stablecoin positions) and `code: "eth"` (for ETH-denominated positions). This establishes whether the wallet's current yields are above or below market.

### 4. Find better alternatives for underperforming positions

For each vault position where the current APY trails the benchmark or looks low:

- Call `vaults_search` with the same asset, `sortBy: "apy30day"`, `sortOrder: "desc"`, `minTvl: 5000000`.
- Exclude vaults with active critical flags.
- Use `apyComposite.totalApy` when present (yield-bearing deposit assets, nested vaults) instead of top-level APY.
- Skip alternatives where the APY improvement is less than 1 percentage point or the vault score is lower than the current position.
- Compute annual USD opportunity cost: `position_value x (alternative_apy - current_apy)`.

### 5. Find yield options for idle assets

For significant idle balances found in step 2:

- Call `best_deposit_options` or `vaults_search` for that asset across the wallet's active networks.
- Exclude critical-flagged vaults.
- Show the top 3 options by risk-adjusted yield (30d APY weighted by score).

### 6. Compile the audit

Present results in this order:

1. **Risk alerts** — any current positions with warning or critical flags
2. **Claimable rewards** — token, amount, USD value
3. **Opportunity cost** — positions where better yield exists, with annual USD gap
4. **Idle assets** — undeployed balances and suggested vaults
5. **Concentration risk** — flag if >50% of deployed value is in one vault, curator, protocol, or network
6. **Portfolio summary** — total deployed, total idle, position count, networks

End with a prioritized action list: claim rewards, rotate underperformers, deploy idle assets.

### 7. Act on recommendations

Present the prioritized action list and **ask the user which actions they want to take**. Do not execute swaps, bridges, or deposits without explicit confirmation for each action.

If the user confirms they want to move assets to a better vault:

```bash
zerion swap <chain> <amount> <current-token> <target-vault-deposit-token>
```

If the best opportunity is cross-chain, confirm with the user first, then bridge:

```bash
zerion bridge <from-chain> <token> <amount> <to-chain> <token> --cheapest
```

## Common Blockers
- **Wallet has no vault positions:** vaults.fyi `positions` returns empty. Fall back to idle-asset analysis only and recommend first deployments.
- **MCP server not connected:** If vaults.fyi tools are unavailable, tell the user to connect the vaults.fyi MCP server. The Zerion-only analysis still works but won't have yield intelligence.
- **Rate data stale for small networks:** Some smaller networks may have limited vault coverage. Note when results are sparse rather than presenting incomplete data as comprehensive.
- **Critical-flagged vaults in alternatives:** Always exclude these. If the only alternatives have critical flags, say no clean alternative exists rather than recommending a flagged vault.
- **Complex deposit/redeem flows:** Some vaults have `depositStepsType: "complex"` or `redeemStepsType: "complex"` (visible in `transaction_context`). Complex deposits may require multiple sequential transactions (e.g., approve → deposit → stake). Complex redeems may involve request-then-claim patterns with delays between steps (hours or days). When recommending alternatives with complex flows, note the friction so the user can weigh APY improvement against operational complexity.
- **Position data mismatch between Zerion and vaults.fyi:** Zerion covers all DeFi positions (LPs, staking, lending); vaults.fyi covers vaults specifically with deeper yield data. A position may appear in Zerion but not in vaults.fyi if it's outside vaults.fyi's protocol coverage, or vice versa if Zerion hasn't indexed a newer vault. Use Zerion as the broad portfolio view and vaults.fyi as the authoritative source for vault-specific yield intelligence.

## Related Skills
- **zerion-analyze** — Zerion's core wallet analysis
- **zerion-trading** — execute swaps and bridges
- **zerion-vaultsfyi-deposit** — deep vault due diligence and safe deposit workflow
- **zerion-vaultsfyi-market-intel** — market-level yield benchmarks and vault comparisons
