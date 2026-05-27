
# vaults.fyi Market Intelligence

**Purpose:** Combine vaults.fyi market data (benchmarks, vault comparisons, curator profiles) with Zerion wallet context to answer "how does the yield market look right now and how does my portfolio compare?"

## When to use
- "How does the yield market look right now?"
- "Compare these two vaults"
- "What are the best USDC yields?"
- "Tell me about Gauntlet's vaults"
- "Are rates high or low right now?"
- "Which vault should I pick?"
- Any request to compare vaults, check market rates, evaluate a curator, or understand the current yield environment

## Key Commands
- `zerion portfolio <address>` — portfolio value and top positions
- `zerion positions <address>` — detailed DeFi positions
- `zerion chains` — list supported chains
- vaults.fyi MCP: `benchmark_apy` — current benchmark rate for a network (USD or ETH)
- vaults.fyi MCP: `benchmark_apy_history` — 30-day benchmark trend
- vaults.fyi MCP: `vaults_search` — find and rank vaults by asset, network, APY, TVL, curator
- vaults.fyi MCP: `vault_details` — full vault metadata for comparison
- vaults.fyi MCP: `vault_apy_history` — 30-day APY history for a specific vault
- vaults.fyi MCP: `curators` — list curators and normalize names
- vaults.fyi MCP: `networks` — all supported networks

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected

## Workflow

### Market Snapshot

Use this flow when the user asks "how does the yield market look?" or wants a general overview.

### 1. Establish benchmark rates

For each target network (default: mainnet, Base, Arbitrum, Optimism):

- Call `benchmark_apy` with `code: "usd"` and `code: "eth"`.
- Call `benchmark_apy_history` for the last 30 days for both benchmarks.

Classify each rate environment:
- **Elevated:** current rate > 1.5x the 30-day average
- **Compressed:** current rate < 0.7x the 30-day average
- **Normal:** between those bounds

### 2. Surface top opportunities by asset

For each target asset (default: USDC, WETH, USDS):

- Call `vaults_search` with `sortBy: "apy30day"`, `sortOrder: "desc"`, `minTvl: 5000000`, `perPage: 20`.
- Exclude vaults with active critical flags.
- Use `apyComposite.totalApy` when present for yield-bearing or nested vaults.

### 3. Compile the snapshot

Present:

| Section | Content |
|---------|---------|
| Benchmark rates | USD and ETH rate by network, current vs 30d average, environment label |
| Top opportunities | Top 3-5 vaults per asset: name, curator, network, 30d APY, TVL, score |
| Market observations | Protocol or curator concentration in top yields, likely incentive campaigns |

### 4. Compare to a wallet (optional)

If the user provides a wallet address, pull their positions from both sources:

```bash
zerion positions <address>
```

Then call vaults.fyi `positions` with the wallet address to get vault-specific APY, score, and flag data. Zerion shows the broad portfolio and USD values; vaults.fyi adds yield metrics and risk context for vault positions specifically. For each vault position, compare the position's yield against the benchmark and top alternatives surfaced in step 2. Flag positions trailing the benchmark.


### Vault Comparison

Use this flow when the user asks to compare specific vaults side-by-side.

### 1. Resolve vaults

For each vault (2-4):

- If the user gave an address, call `vault_details` with the address and network.
- If the user gave a name, call `vaults_search` to resolve it first.

Confirm whether the vaults share the same underlying asset. If they don't, note the comparison is cross-asset and avoid simple APY ranking.

### 2. Gather history and benchmarks

For each vault:

- Call `vault_apy_history` for 30 days.
- Call `benchmark_apy` for the vault's network and asset type.

### 3. Present the comparison

| Field | Vault A | Vault B | Vault C |
|-------|---------|---------|---------|
| Network | | | |
| Protocol | | | |
| Curator | | | |
| Asset | | | |
| 1d / 7d / 30d APY | | | |
| vs Benchmark | | | |
| TVL | | | |
| Score | | | |
| Flags | | | |
| Fees | | | |
| APY stability (30d) | | | |

Recommend:
- **Best risk-adjusted yield:** highest 30d APY among clean, high-score vaults
- **Maximum APY option:** if different from above and not critical-flagged
- **Fee caveat:** if fees materially change the ranking

Critical-flagged vaults cannot be recommended.


### Curator Overview

Use this flow when the user asks about a specific curator (e.g., "tell me about Gauntlet's vaults").

### 1. Resolve the curator

Call `curators` to normalize the name. Users may type "Steakhouse" when the canonical name is "Steakhouse Financial".

### 2. Pull the curator's vaults

Call `vaults_search` with `curators: [curator_name]`, `sortBy: "tvl"`, `sortOrder: "desc"`. Apply optional asset and network filters if the user specified them.

### 3. Present the overview

- **Curator profile:** name, vault count, total TVL, active networks, assets managed
- **Vault list:** vault, asset, network, TVL, 30d APY, score, flags
- **Aggregates:** TVL-weighted average APY, average score, min/max score
- **Incidents:** any warning or critical flags by vault
- **Best pick:** highest 30d APY vault with no active flags and score above 80. If no vault meets that bar, say so.

### 4. Compare to wallet (optional)

If the user has a wallet, check whether they hold any of this curator's vaults:

```bash
zerion positions <address>
```

Surface whether their exposure to this curator is concentrated or diversified.

## Common Blockers
- **Benchmark data unavailable for a network:** Some newer or smaller networks may lack benchmark history. Note the gap rather than omitting the network silently.
- **Curator name not found:** `curators` didn't match. Ask the user for the exact name or try a partial search via `vaults_search` with a curator filter.
- **Cross-asset comparison:** Two vaults with different underlying assets can't be ranked by APY alone. Flag this and compare them as separate opportunities.
- **Too many vaults for comparison:** Cap at 4. If the user asks for more, suggest narrowing by asset or network.
- **Complex deposit/redeem flows:** When recommending vaults or comparing options, note when a vault has `depositStepsType: "complex"` or `redeemStepsType: "complex"`. A vault with 2% higher APY but a quarterly settlement window or multi-step deposit may not be the right pick for a user who values liquidity.

## Related Skills
- **capabilities/analyze.md** — wallet analysis and PnL
- **zerion-vaultsfyi-yield-optimizer** — full portfolio audit with opportunity cost
- **zerion-vaultsfyi-deposit** — act on a vault pick with safety checks
