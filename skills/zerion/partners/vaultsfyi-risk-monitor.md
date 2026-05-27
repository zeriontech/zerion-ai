
# vaults.fyi Risk Monitor

**Purpose:** Monitor a wallet's DeFi vault positions for risk events using vaults.fyi's flag and scoring infrastructure alongside Zerion wallet context, catching problems before they become losses.

## When to use
- "Are any of my positions in trouble?"
- "Check my vaults for risk flags"
- "Is it safe to stay in this vault?"
- "Monitor my positions for problems"
- "Did anything change with my vaults?"
- "Are there any incidents I should know about?"
- Any request to check safety, monitor risk, or scan for problems across vault positions

## Key Commands
- `zerion positions <address>` — current DeFi positions
- `zerion portfolio <address>` — total portfolio value
- `zerion history <address> --limit 20` — recent transactions for context
- vaults.fyi MCP: `positions` — vault positions with scores, flags, and curator data
- vaults.fyi MCP: `vault_details` — deep inspection of flagged or concerning vaults
- vaults.fyi MCP: `vault_apy_history` — detect APY collapse or volatility
- vaults.fyi MCP: `vault_tvl_history` — detect capital flight from a vault
- vaults.fyi MCP: `benchmark_apy` — compare position yield against market baseline
- vaults.fyi MCP: `vaults_search` — find safer alternatives for positions that need to be exited
- vaults.fyi MCP: `transaction_context` — check withdrawal availability and constraints

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected

## Workflow

### 1. Pull all positions

Get the full picture from both Zerion and vaults.fyi:

```bash
zerion positions <address>
```

Call vaults.fyi `positions` with the wallet address to get vault positions with scores, flags, APY, and curator data.

**How these two tools work together:** Zerion shows all DeFi positions with USD values — broad coverage across protocols. vaults.fyi shows vault-specific yield intelligence: APY methodology, risk scores, curator attribution, incident flags. A position may appear in one but not the other (Zerion covers protocols outside vaults.fyi's scope; vaults.fyi may index newer vaults Zerion hasn't added). Use Zerion for the portfolio-wide view and vaults.fyi as the authoritative source for vault risk and yield data.

### 2. Flag scan (highest priority)

For every position, check for active flags. Classify by severity:

**CRITICAL — Immediate action required:**
- Active critical flags (exploit, depeg, insolvency, frozen withdrawals)
- Action: surface immediately with incident details. Recommend exit if withdrawals are available.

**WARNING — Attention needed:**
- Active warning flags (elevated risk, audit concern, unusual behavior)
- Action: surface with context. Assess whether the warning is informational or actionable.

**WATCH — Monitor closely:**
- Score below 50
- Score dropped more than 15 points from the vault's historical baseline
- Action: note as degraded. Check allocation and TVL trends for supporting evidence.

### 3. Yield health check

For each position, compare current performance against benchmarks:

- Call `benchmark_apy` for the position's network and asset type (USD or ETH).
- Flag positions where 30d APY is more than 2 percentage points below the benchmark.
- Call `vault_apy_history` with `fromTimestamp` set to 30 days ago (current unix timestamp minus 2592000) to detect APY decay (declining trend over the last 7-14 days).

Classify:

- **Healthy:** APY at or above benchmark, stable trend
- **Underperforming:** APY below benchmark but stable
- **Decaying:** APY trending downward, losing more than 1 percentage point over 14 days
- **Collapsed:** APY dropped more than 50% from 30-day average

### 4. Capital flow analysis

For positions above $10,000 in value:

- Call `vault_tvl_history` with `fromTimestamp` set to 30 days ago.
- Flag vaults where TVL dropped more than 20% in the last 14 days — capital flight often precedes or accompanies problems.
- Flag vaults where TVL spiked more than 50% — sudden inflows can dilute yield or signal mercenary capital chasing temporary incentives.

### 5. Withdrawal readiness

For any position flagged in steps 2-4:

- Call `transaction_context` to check whether withdrawal is currently available.
- Check `transactionalProperties.redeemStepsType`: if `"complex"`, the exit requires multiple transactions with potential delays. The `vaultSpecificData` field may contain cooldown durations, queue positions, or settlement window dates.
- Identify cooldown requirements, withdrawal queues, request-then-claim patterns, or timelock constraints.
- If immediate exit isn't possible, surface the earliest available exit path and timeline. For vaults with complex redeem flows, note whether the user needs to initiate a cooldown/request action now to start the clock.

### 6. Concentration risk

Across the full portfolio, flag:

- **Single vault:** >50% of deployed capital in one vault
- **Single curator:** >50% of deployed capital managed by one curator
- **Single protocol:** >50% of deployed capital in one protocol
- **Single network:** >70% of deployed capital on one network

### 7. Compile the risk report

Present in priority order:

**1. Critical alerts** (if any)
- Vault name, flag description, incident details, current position value
- Withdrawal availability
- Recommended action

**2. Warnings**
- Vault name, warning description, score, position value
- Whether the warning is new or ongoing

**3. Yield health**
- Positions by health classification (healthy / underperforming / decaying / collapsed)
- Benchmark comparison for underperformers

**4. Capital flow signals**
- Vaults with significant TVL changes and what that might indicate

**5. Concentration risk**
- Portfolio-level concentration flags

**6. Portfolio status**
- Total deployed value, number of positions, overall risk posture (clean / caution / action needed)

### 8. Suggest actions

For each flagged position, recommend a specific next step:

- **Critical flag:** "Exit this position. Use `zerion-vaultsfyi-rebalance` to move to a safer alternative."
- **Decaying yield:** "APY has dropped X%. Consider rotating to [alternative] which is currently yielding Y%."
- **Capital flight:** "TVL down Z% in 14 days. Monitor closely or preemptively exit before withdrawal congestion increases."
- **Concentration:** "Over 50% in [curator/protocol]. Diversify across at least 2-3 curators."

For exit recommendations, confirm alternatives exist:

- Call `vaults_search` for the same asset with `minTvl: 5000000`, excluding critical-flagged vaults.
- Present the top 2-3 clean alternatives with APY, score, and curator.

## Common Blockers
- **No active flags across all positions:** Good news. Report the portfolio as clean with current scores and benchmark comparisons. A clean report is still valuable.
- **Flag data is point-in-time:** Flags reflect current state, not history. A vault may have had a critical flag last week that's since been resolved. Note that flag monitoring is most useful when run regularly.
- **Withdrawal not available due to cooldown:** Some exit paths require initiating a cooldown first. Surface the timeline so the user can plan.
- **False positives on TVL changes:** TVL can drop because a single large depositor withdrew (whale exit), not because of a vault problem. Note this possibility when flagging TVL declines.

## Related Skills
- **zerion-vaultsfyi-rebalance** — execute exits and rotations flagged by the risk monitor
- **zerion-vaultsfyi-yield-optimizer** — broader yield optimization beyond risk
- **zerion-vaultsfyi-strategist** — deep historical analysis on flagged vaults
- **zerion-vaultsfyi-watchlist** — extend risk monitoring to tracked wallets beyond your own
- **capabilities/analyze.md** — Zerion's wallet analysis for portfolio context
