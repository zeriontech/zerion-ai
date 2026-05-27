
# vaults.fyi Watchlist Monitor

**Purpose:** Combine Zerion's wallet watchlist with vaults.fyi yield intelligence to continuously monitor tracked wallets for yield changes, risk events, and opportunities.

## When to use
- "Watch this wallet and track its yield positions"
- "What vaults is this address using?"
- "Monitor my positions for yield decay"
- "Track this whale's DeFi strategy"
- "Add this wallet to my watchlist and audit its yield"
- Any request to track, monitor, or follow a wallet's DeFi vault positions over time

## Key Commands
- `zerion watch <address> --name <label>` — add a wallet to the watchlist
- `zerion watch list` — list all watched wallets
- `zerion watch remove <name>` — stop watching a wallet
- `zerion positions <address>` — current DeFi positions for a watched wallet
- `zerion portfolio <address>` — portfolio value snapshot
- `zerion history <address>` — recent transaction history
- vaults.fyi MCP: `positions` — vault positions with APY, score, flags, curator data
- vaults.fyi MCP: `wallet_balances` — idle assets not deployed in vaults
- vaults.fyi MCP: `rewards` — claimable rewards across positions
- vaults.fyi MCP: `vault_details` — deep dive on any vault a watched wallet holds
- vaults.fyi MCP: `benchmark_apy` — compare position yields to market benchmarks
- vaults.fyi MCP: `vaults_search` — find better alternatives for underperforming positions

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected

## Workflow

### 1. Set up the watchlist

Add wallets to Zerion's watchlist with descriptive labels:

```bash
zerion watch <address> --name "my-main"
zerion watch <address> --name "treasury"
zerion watch <address> --name "whale-gauntlet"
```

Verify the watchlist:

```bash
zerion watch list
```

### 2. Snapshot each watched wallet

For each wallet on the watchlist:

Pull the portfolio overview from Zerion (broad DeFi positions with USD values):

```bash
zerion positions <address>
```

Then pull the yield intelligence layer from vaults.fyi:

- Call `positions` for vault positions with APY, score, flags, and curator data. This adds yield metrics and risk context that Zerion doesn't provide. A position may appear in Zerion but not in vaults.fyi (if outside vault protocol coverage) or vice versa — use both for completeness.
- Call `wallet_balances` for idle assets.
- Call `rewards` for claimable rewards.

### 3. Build the yield profile

For each wallet, compile:

- **Active vault positions:** vault name, curator, network, asset, value, 30d APY, score, flags
- **Benchmark comparison:** call `benchmark_apy` for each network/asset combination and flag positions trailing the benchmark
- **Idle assets:** undeployed balances that could be earning yield
- **Claimable rewards:** uncollected rewards with USD value
- **Concentration:** allocation by vault, curator, protocol, network

### 4. Cross-wallet analysis (multiple watched wallets)

When monitoring multiple wallets, surface patterns across them:

- **Shared positions:** vaults held by multiple watched wallets (signals consensus)
- **Strategy differences:** where wallets diverge on asset allocation or curator choice
- **Aggregate exposure:** total watched TVL by protocol, curator, and network
- **Best performer:** which wallet is achieving the highest risk-adjusted yield

### 5. Detect changes (repeat monitoring)

On subsequent runs, compare to the previous snapshot:

- **New positions:** vaults entered since last check
- **Exited positions:** vaults withdrawn from
- **APY drift:** positions where 30d APY moved more than 1 percentage point
- **Score changes:** vaults where the risk score degraded
- **New flags:** any new warning or critical incidents
- **New idle assets:** tokens withdrawn but not redeployed

Use Zerion's transaction history for context on what changed:

```bash
zerion history <address> --limit 20
```

### 6. Surface opportunities

For positions trailing the benchmark or showing APY decay:

- Call `vaults_search` for higher-yield alternatives on the same asset.
- Exclude critical-flagged alternatives.
- Present the opportunity with the annual USD gap.

For significant idle assets:

- Call `vaults_search` to find deployment options.
- Filter by score and TVL minimums.

## Common Blockers
- **Wallet has no vault positions:** The watched wallet may only hold tokens without vault exposure. Report balances and suggest first deployments instead.
- **Watched wallet is a contract (multisig, DAO treasury):** Positions still show up via vaults.fyi, but Zerion's position display may differ. Use vaults.fyi `positions` as the authoritative source for vault data.
- **Too many watched wallets:** Fan-out scales linearly. Cap deep analysis at 5-10 wallets per run. For larger watchlists, show summary-only and let the user drill into specific wallets.
- **No prior snapshot for comparison:** On the first run, there's no baseline. Present the current state and note that change detection will work on subsequent runs.
- **Complex redeem flows on watched positions:** When flagging positions for exit, check `transactionalProperties.redeemStepsType`. If `"complex"`, note that exiting requires multiple steps with potential delays — the user (or wallet owner) needs lead time to initiate cooldowns or catch settlement windows.

## Related Skills
- **zerion-vaultsfyi-yield-optimizer** — deep audit for a single wallet
- **zerion-vaultsfyi-risk-monitor** — focused risk and flag monitoring
- **capabilities/analyze.md** — Zerion's core wallet analysis
- **zerion-vaultsfyi-strategist** — historical analysis and backtesting for vaults found in watched wallets
