---
name: zerion-vaultsfyi-rebalance
description: >
  Move assets from one DeFi vault to another using vaults.fyi for exit/entry transaction construction and safety checks, with Zerion CLI handling swaps and cross-chain bridging between positions.
license: MIT
---

# vaults.fyi Rebalance

**Purpose:** Execute a full vault-to-vault rebalance using vaults.fyi for withdrawal and deposit transaction construction (with safety gates at every step) and Zerion CLI for any swaps or cross-chain bridges needed between the exit and entry.

## When to use
- "Move my USDC from this Morpho vault to that Aave vault"
- "Rebalance from vault A to vault B"
- "Exit this position and put it into a better vault"
- "Rotate my yield position to a higher-APY vault on another chain"
- "Switch curators"
- Any request to move assets between DeFi vaults, including cross-chain and cross-asset rebalances

## Key Commands
- `zerion portfolio <address>` — confirm wallet state before and after
- `zerion positions <address>` — verify DeFi positions
- `zerion swap <chain> <amount> <from> <to>` — swap between assets if the destination vault takes a different token
- `zerion bridge <from-chain> <token> <amount> <to-chain> <token>` — bridge assets cross-chain between exit and entry
- vaults.fyi MCP: `vault_details` — inspect both source and destination vaults
- vaults.fyi MCP: `position_details` — current position value and state in the source vault
- vaults.fyi MCP: `transaction_context` — pre-flight check for both withdrawal and deposit
- vaults.fyi MCP: `build_vault_tx` — construct unsigned withdrawal and deposit transactions
- vaults.fyi MCP: `vaults_search` — find the destination vault if not specified
- vaults.fyi MCP: `benchmark_apy` — confirm the rebalance actually improves yield vs benchmark
- vaults.fyi MCP: `submit_tx_hash` / `get_transaction_status` — track transactions post-signing

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected
- An existing vault position to exit

## Workflow

### 1. Confirm the current position

Check the wallet's state and identify the source vault position.

```bash
zerion positions <address>
```

Call vaults.fyi `position_details` with the wallet address and source vault to get: current value, unrealized returns, the vault's withdrawal mechanics, and any active flags.

### 2. Check for withdrawal constraints

Call `vault_details` on the source vault and call `transaction_context` to inspect the redeem flow:

- **Redeem flow type (`redeemStepsType`):** Check `transactionalProperties.redeemStepsType`. If `"instant"`, withdrawal is a single transaction. If `"complex"`, the exit requires multiple steps with potential delays between them (e.g., request withdrawal → wait for processing → claim). Complex redeems may involve cooldown periods (hours or days), withdrawal queues, or settlement windows. The `vaultSpecificData` field in `transaction_context` may contain timing details.
- **Cooldown period:** Some vaults require initiating a cooldown before withdrawal is available. If a cooldown is required, the agent must call the cooldown action first and inform the user of the wait time before proceeding. Do not attempt to wait — cooldowns can be hours or days.
- **Withdrawal queue:** Some vaults process withdrawals asynchronously. Note the expected timeline.
- **Exit fees:** Withdrawal or performance fees that reduce the rebalanced amount.
- **Active flags:** If the source vault has a critical flag, that may actually strengthen the case for exiting. Note this.

### 3. Inspect the destination vault

Call `vault_details` on the destination vault. Run the same safety checks as the deposit skill:

- **Critical flag:** STOP. Do not proceed. Suggest alternatives via `vaults_search`.
- **Warning flag:** Present the warning and require explicit user confirmation.
- **Score check:** If the destination vault scores lower than the source, flag the tradeoff.
- **Capacity:** Confirm the destination can accept the deposit amount.

Call `benchmark_apy` for the destination vault's network and asset type. Confirm the rebalance produces a meaningful APY improvement (at least 1 percentage point after fees).

### 4. Present the rebalance plan

Before building any transactions, show the user:

| Field | Source Vault | Destination Vault |
|-------|-------------|-------------------|
| Vault name | | |
| Curator | | |
| Network | | |
| Asset | | |
| 30d APY | | |
| Score | | |
| Flags | | |
| Fees (exit/entry) | | |

- **Net APY improvement** after accounting for exit fees, entry fees, and any swap/bridge costs
- **Route:** same-chain direct, same-chain with swap, or cross-chain with bridge
- **Estimated steps:** cooldown (if needed) → withdraw → swap/bridge (if needed) → deposit
- **Risks:** cooldown wait time, bridge slippage, temporary undeployed period

Require explicit user approval before proceeding.

### 5. Execute the withdrawal

Call `build_vault_tx` with `action: "redeem"` (or `"request-redeem"` for complex flows), `userAddress`, `network`, and `vaultId` for the source vault. Present the unsigned transaction to the user for signing.

After signing and broadcasting:

- Call `submit_tx_hash` with `sessionId`, `stepId` (from the `build_vault_tx` response), and the broadcast `txHash` to track the withdrawal.
- Call `get_transaction_status` to confirm the withdrawal settled.
- Verify the assets arrived in the wallet:

```bash
zerion portfolio <address>
```

### 6. Route assets to the destination (if needed)

If the destination vault is on the same chain and accepts the same asset, skip to step 7.

If the withdrawn asset doesn't match what the destination vault requires (different token or different chain), **stop and present the routing options to the user**:

- Explain what was withdrawn and what the destination vault needs
- Show the available routes: swap (same chain, different token), bridge (different chain), or both

Ask the user to confirm which route to take before executing.

For a swap (same chain, different token):

```bash
zerion swap <chain> <amount> <withdrawn-token> <deposit-token>
```

For a bridge (different chain):

```bash
zerion bridge <source-chain> <token> <amount> <dest-chain> <token> --cheapest
```

For cross-chain + different asset, bridge first, then swap on the destination chain.

### 7. Execute the deposit

Call `transaction_context` for the destination vault to confirm the deposit asset, decimals, and wallet balance.

Call `build_vault_tx` with `action: "deposit"`, `userAddress`, `network`, `vaultId`, and preferably `humanAmount` + `decimals` from `transaction_context` (the tool converts to base units automatically). Present the unsigned transaction for signing.

After signing and broadcasting:

- Call `submit_tx_hash` with `sessionId`, `stepId`, and `txHash` to track the deposit.
- Call `get_transaction_status` to confirm the deposit settled.

### 8. Verify the rebalance

Confirm the new position with both Zerion and vaults.fyi:

```bash
zerion positions <address>
```

Call `position_details` on the destination vault to confirm the position is active with the expected value.

## Common Blockers
- **Complex redeem on source vault (`redeemStepsType: "complex"`):** The exit may require multiple transactions with delays between them. Common patterns: (1) request-then-claim with a processing period, (2) cooldown initiation followed by a waiting period before withdrawal unlocks (e.g., Ethena sUSDe), (3) quarterly settlement windows where withdrawals only process at specific dates. Check `transaction_context` for the specific flow and `vaultSpecificData` for timing. Inform the user upfront that the rebalance will span multiple sessions.
- **Complex deposit on destination vault (`depositStepsType: "complex"`):** The entry may also require multiple sequential transactions. Present the full deposit sequence after the withdrawal completes so the user knows the total operational cost.
- **Cooldown required on source vault:** The agent must initiate the cooldown action first and inform the user they'll need to return later to complete the withdrawal. Do not attempt to wait — cooldowns can be hours or days.
- **Withdrawal queue delays:** Some vaults process exits asynchronously. Note the expected timeline and pause the workflow until the withdrawal settles.
- **Rebalance not worth it:** If the net APY improvement after fees and slippage is less than 1 percentage point, recommend staying in the current vault rather than churning. Factor in the operational complexity — a complex redeem + complex deposit rebalance has higher friction cost than an instant-to-instant move.
- **Destination vault at capacity:** Suggest alternative vaults via `vaults_search` with the same asset and network.
- **Cross-chain bridge slippage:** Large rebalances across chains may face meaningful slippage. Show the estimated bridge output before proceeding.
- **Temporary undeployed period:** Between withdrawal settling and deposit completing, assets sit idle in the wallet earning nothing. For large positions, this opportunity cost matters. Note the expected gap duration.

## Related Skills
- **zerion-vaultsfyi-yield-optimizer** — identifies which positions should be rebalanced
- **zerion-vaultsfyi-deposit** — standalone deposit with full due diligence
- **zerion-trading** — swap and bridge execution
- **zerion-vaultsfyi-risk-monitor** — monitors positions post-rebalance
