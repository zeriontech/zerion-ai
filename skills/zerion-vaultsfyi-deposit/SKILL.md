---
name: zerion-vaultsfyi-deposit
description: >
  Research a DeFi vault using vaults.fyi due diligence (risk, performance, fees, benchmarks), build a deposit transaction via vaults.fyi with pre-flight safety checks, and use Zerion CLI for asset acquisition and post-deposit verification.
license: MIT
---

# vaults.fyi Safe Deposit

**Purpose:** Run vault due diligence via vaults.fyi and execute deposits through Zerion CLI, with safety gates that block critical-flagged vaults and require explicit approval for warned ones.

## When to use
- "Deposit into [vault name] on [network]"
- "Is this vault safe to deposit into?"
- "Put my USDC into Morpho on Base"
- "Research this vault before I deposit"
- "Stake into a yield vault"
- Any request to deposit, enter, or stake into a specific DeFi vault with a safety or due diligence step

## Key Commands
- `zerion portfolio <address>` — check current holdings and balances
- `zerion positions <address>` — see existing DeFi positions
- `zerion swap <chain> <amount> <from> <to>` — swap into the vault's deposit asset if needed
- `zerion bridge <from-chain> <token> <amount> <to-chain> <token>` — bridge assets cross-chain
- vaults.fyi MCP: `vault_details` — full vault metadata, score, flags, fees, curator
- vaults.fyi MCP: `vault_apy_history` — historical APY over 30 days
- vaults.fyi MCP: `vault_tvl_history` — historical TVL over 30 days
- vaults.fyi MCP: `benchmark_apy` — network benchmark rate for comparison
- vaults.fyi MCP: `transaction_context` — deposit asset, decimals, wallet balance, available actions
- vaults.fyi MCP: `build_vault_tx` — construct unsigned deposit transaction
- vaults.fyi MCP: `vaults_search` — resolve vault by name if no address given

## Requirements
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- [vaults.fyi hosted MCP v2](https://mcp.vaults.fyi/mcp) connected
- A funded wallet with sufficient balance of the deposit asset

## Workflow

### 1. Confirm wallet readiness

Check the wallet's current state with Zerion to confirm it has the assets needed.

```bash
zerion portfolio <address>
```

Note the available balances. If the user needs to acquire the deposit token first, flag the gap and ask how they'd like to proceed before taking any action.

### 2. Resolve the vault

If the user provided a vault name rather than an address:

- Call `vaults_search` with the name, asset, and network to find the matching vault.
- Confirm the match with the user if multiple results come back.

If the user provided an address, call `vault_details` directly with the address and network.

### 3. Run due diligence

Gather the full risk and performance picture:

- Call `vault_details` for score, flags, fees, curator, protocol, capacity, and underlying asset.
- Call `vault_apy_history` for 30-day APY trend. Set `fromTimestamp` to 30 days ago (current unix timestamp minus 2592000) to get recent data.
- Call `vault_tvl_history` for 30-day TVL trend. Set `fromTimestamp` the same way.
- Call `benchmark_apy` with the matching benchmark (`usd` for stablecoins, `eth` for ETH-denominated vaults) on the vault's network.

Use `apyComposite.totalApy` when present instead of top-level APY.

Present a due diligence summary:

| Field | Value |
|-------|-------|
| Vault | name, protocol, curator, network |
| APY | 1d / 7d / 30d, composite if applicable |
| vs Benchmark | spread over network benchmark |
| TVL | current, 30d trend |
| Score | value out of 100, penalty notes |
| Flags | active warnings or critical incidents |
| Fees | performance, management, withdrawal |
| Capacity | deposit cap or remaining capacity |

### 4. Safety gate

This is the hard safety check before building any transaction.

- **Critical flag active:** STOP. Do not proceed to transaction building. Report: "BLOCKED: this vault has an active critical incident. Do not deposit."
- **Warning flag active:** Present the warning details and require explicit user confirmation before continuing.
- **Clean (no flags, score above threshold):** Proceed with a green status.

### 5. Check balance and prepare the deposit asset

Call `transaction_context` with the wallet address, network, and vault ID to get:
- Required deposit asset and decimals
- Wallet balance of that asset
- Available deposit actions

If the wallet doesn't have enough of the deposit asset, **stop and notify the user**. Explain clearly:
- Which asset is required and how much
- What the wallet currently holds on this network
- Whether the wallet holds the asset on other networks (potential bridge) or holds other tokens on this network (potential swap)

Ask the user whether they want to:
1. **Swap** — convert another token on the same chain into the deposit asset
2. **Bridge** — bring the asset from another chain

Only proceed after the user confirms which option they prefer.

For a swap:

```bash
zerion swap <chain> <amount> <held-token> <deposit-asset>
```

For a bridge:

```bash
zerion bridge <from-chain> <held-token> <amount> <vault-chain> <deposit-asset> --cheapest
```

### 6. Check deposit flow type

Inspect `transactionalProperties.depositStepsType` from `vault_details` or `transaction_context`:

- **`"instant"`**: Standard single-step deposit. Proceed to building the transaction.
- **`"complex"`**: Multi-step deposit flow. This may require multiple sequential transactions (e.g., approve → deposit → stake, or deposit → bridge → confirm). Present all steps to the user upfront with the expected sequence and any delays between steps. Some complex flows require waiting for on-chain confirmations between steps before the next step can execute.

### 7. Build the deposit transaction

After safety and balance checks pass:

- Call `build_vault_tx` with `action: "deposit"`, `userAddress`, `network`, `vaultId`, and preferably `humanAmount` (e.g. "10") + `decimals` from `transaction_context` (e.g. 6 for USDC, 18 for WETH). The tool converts to base units automatically.
- For complex deposit flows, `build_vault_tx` returns multiple ordered steps. Present all steps with their sequence and any required delays.
- Present the unsigned transaction steps and decoded calls to the user.
- Do not sign or broadcast. The user must explicitly approve.

### 8. Post-deposit tracking

After the user signs and broadcasts the transaction:

- Call `submit_tx_hash` with `sessionId` and `stepId` (from the `build_vault_tx` response) and the broadcast `txHash`.
- Call `get_transaction_status` to confirm the deposit landed.
- Verify the new position with Zerion:

```bash
zerion positions <address>
```

## Common Blockers
- **Vault not found:** Name-based search returns no results. Ask the user for the contract address and network directly.
- **Insufficient balance:** The wallet lacks the deposit asset. Notify the user and ask whether they want to swap or bridge before retrying.
- **Critical flag blocks deposit:** This is intentional. Do not bypass. Explain the incident to the user.
- **Approval step already satisfied:** `build_vault_tx` may include a token approval step that's redundant if the wallet already has sufficient allowance. Note this rather than presenting every approval as required.
- **Vault at capacity:** Some vaults have deposit caps. If capacity is exhausted, say so and suggest alternatives via `vaults_search`.
- **Complex deposit flow (`depositStepsType: "complex"`):** Some vaults require multiple sequential transactions to complete a deposit. Steps may include approvals, deposits into intermediate contracts, staking, or bridging. Present the full sequence to the user before starting. Some steps require on-chain confirmation before the next step can execute — do not batch them blindly.
- **Complex redeem flow on later exit (`redeemStepsType: "complex"`):** Even if the deposit is instant, the vault may have complex withdrawal mechanics (request-then-claim with delays, cooldown periods, quarterly settlement windows). Surface this during due diligence so the user knows the liquidity profile before entering. Check `transactionalProperties.redeemStepsType` and any vault-specific data about withdrawal timing.

## Related Skills
- **zerion-trading** — swap and bridge commands for acquiring deposit assets
- **zerion-analyze** — wallet analysis before depositing
- **zerion-vaultsfyi-yield-optimizer** — find the best vault before depositing
- **zerion-vaultsfyi-market-intel** — market context and vault comparisons
