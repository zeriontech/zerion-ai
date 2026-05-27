
# Zerion — Consolidate

Sweep every sweepable wallet position on a single chain into one target token. The command lists positions, filters defaults (target token, native gas, stables, dust, protocol positions), fetches one Zerion swap quote per remaining row, applies a max-loss filter, and either prints a plan (dry-run) or broadcasts each swap sequentially (`--execute`).

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the parent `SKILL.md` (Setup + Authentication). **Trading needs an API key + agent token** (pay-per-call does NOT apply).

## When to use

- "Consolidate all tokens on Base into USDC"
- "Sweep dust on ethereum into ETH"
- "Convert everything in this wallet to MON on monad"
- "Treasury cleanup — gather every position on arbitrum into one token"
- "Solana same-chain sweep into SOL or USDC"

For balance inspection before sweeping → `capabilities/analyze.md`. For a single swap → `capabilities/trading.md`. For setting up an agent token → `capabilities/agent-management.md`.

## Command shape

```
zerion consolidate <chain> <to-token> [flags]
```

`<to-token>` accepts either:

- A **curated symbol** — the chain's native gas token (e.g. `ETH` on base, `POL` on polygon, `SOL` on solana) or one of the canonical bluechips in `cli/utils/trading/consolidate-targets.js` (`USDC`, `USDT`, `DAI`, `WETH`, `WBTC`). The curated map stores one Zerion fungible id per asset; the chain implementation address is fetched live from `GET /fungibles/{id}`. Whichever address Zerion lists for that fungible on the chain — Circle-native USDC on some chains, bridged USDC.e on others — is what gets targeted.
- A **contract address** — `0x…` on EVM chains, base58 on Solana. Use this for any token outside the curated list, or to override Zerion's choice (e.g. to target Circle-native USDC on a chain where Zerion's canonical USDC impl is the bridged variant).

Anything else fails with `target_token_not_found` and the error names the curated symbols.

| Flag | Default | Meaning |
|---|---|---|
| `--execute` | _(off)_ | Broadcast the ready rows. Without this, the command prints a plan only. |
| `--min-value <usd>` | `1` | Skip positions below this USD value (marked `skipped: dust`). |
| `--max-value <usd>` | _(no cap)_ | Skip positions above this USD value (marked `skipped: above_max`). Pair with `--min-value` to sweep only a band — useful for "clear dust, keep main bags". |
| `--max-loss <pct>` | `5` | Reject quotes losing more than this fraction vs current value. Dual form: values > 1 treated as percent (`5` → 5%), values ≤ 1 as fraction (`0.05` → 5%). |
| `--include-stables` | _(off)_ | Include stablecoins (USDC, USDT, USDC.e, USDT0, USDS, TUSD, USDe). Match is case-insensitive; bridged USDC.e is treated as a stable so it isn't unintentionally swept. |
| `--exclude-stables` | _(off)_ | Force-exclude stables, no prompt. |
| `--include <symbols>` | _(none)_ | Comma-separated symbols to force-include even if filtered (case-insensitive). |
| `--exclude <symbols>` | _(none)_ | Comma-separated extra exclusions on top of defaults. |
| `--include-native` | _(off)_ | Sweep the chain's native gas token (ETH/SOL/etc). |
| `--gas-reserve <amount>` | per-chain default | Native units to reserve when `--include-native` is on. Requires `--include-native`. |
| `--slippage <pct>` | `2` | Per-quote slippage tolerance, percent. Accepts 0–100; **values above ~5 burn substantial money across an N-position sweep** — keep low unless you know the destination is illiquid. |
| `--concurrency <n>` | tier-aware (paid → 5, dev → 1) | Plan-phase quote-fetch concurrency. Integer `1..10`. Does NOT affect `--execute`; the broadcast phase is always sequential. |
| `--wallet <name>` | default | Source wallet. |
| `--timeout <sec>` | `120` | Per-swap confirmation timeout. |

Per-row failures during `--execute` are isolated — the batch continues. Each successful swap lands on chain immediately; each failure is recorded with its full error string and surfaced in the final `Failures:` block of the result. There is no opt-out: a single failing quote should not gate a sweep of independent on-chain transactions. If you genuinely want to halt mid-batch, Ctrl-C the process.

The plan-phase concurrency is auto-picked from your active `ZERION_API_KEY` tier: `zk_dev_*` keys stay sequential (the 120 req/min dev limit trips quickly when sweeping a wallet with many positions); other `zk_*` (paid/prod/live) keys fan out to 5. Override with `--concurrency <n>` (1..10). The chosen value is reported in both the JSON output (`concurrency`, `apiKeyTier`, `concurrencySource` fields) and the pretty header (`Concurrency: 5 (paid key, auto)`).

Boolean flags (`--execute`, `--include-stables`, `--exclude-stables`, `--include-native`) should appear **last on the command line**, or use the `--flag=true` / `--no-flag` forms. The flag parser consumes the next non-`--` token as the value, so `--include-native ethereum` would mistakenly set `include-native="ethereum"`. The CLI rejects that with `invalid_flag_value`.

## Examples

```bash
# Dry-run — plan only, no signing.
zerion consolidate base USDC

# Sweep everything on base into ETH, including the native ETH balance.
zerion consolidate base ETH --include-native

# Execute — broadcasts each ready row sequentially after one passphrase prompt.
zerion consolidate base USDC --execute

# Allow looser loss tolerance (8%) and force-exclude WETH.
zerion consolidate base USDC --max-loss 8 --exclude WETH --execute

# Include stables in the sweep, override the dust threshold.
zerion consolidate ethereum USDC --include-stables --min-value 5

# Dust cleanup only — sweep rows up to $10 into USDC, leave main bags alone.
zerion consolidate base USDC --max-value 10

# Band — sweep mid-size positions ($5–$50). Outside the band: dust below, main bags above.
zerion consolidate base USDC --min-value 5 --max-value 50

# Solana same-chain consolidation into SOL.
zerion consolidate solana SOL --execute

# Sweep into the native chain token while keeping 0.002 ETH for gas.
zerion consolidate base ETH --include-native --gas-reserve 0.002 --execute
```

## Output

### Dry-run plan (default)

JSON to stdout. Each row carries:

```json
{
  "symbol": "WETH",
  "quantity": 0.052,
  "value_usd": 187.4,
  "expected_output": 186.1,
  "expected_output_usd": 186.1,
  "loss_pct": 0.0069,
  "status": "ready"
}
```

`status` is one of:

| Status | Meaning |
|---|---|
| `ready` | Quote within max-loss; ready to broadcast on `--execute`. |
| `blocked` | Quote exceeds max-loss (`reason: "max_loss"`). |
| `no_route` | The Zerion API returned no executable route for this pair. |
| `skipped` | Filtered out: `dust` (below `--min-value`), `above_max` (above `--max-value`), `below_reserve` (native row), or `no_price`. |

The totals line shows: `N ready, M blocked, K skipped, expected ~X TARGET (~$Y)`.

### `--execute` result

```json
{
  "executed": true,
  "results": [
    { "symbol": "WETH", "hash": "0x…", "status": "success", "blockNumber": 1234, "gasUsed": "42000" }
  ],
  "summary": { "succeeded": 1, "failed": 0 }
}
```

## Filter defaults

By default the plan **excludes**:

1. The target token itself — by symbol AND by the address Zerion lists for the target's fungible on this chain. On chains where Zerion treats a bridged variant (e.g. USDC.e on polygon) as the canonical impl of `USDC`, positions at that address are excluded automatically; positions whose symbol is `USDC` at any other address are also excluded via the symbol check.
2. The chain's native gas token (use `--include-native` to opt in).
3. Stablecoins (use `--include-stables` to opt in, or answer the interactive prompt yes).
4. Positions below `--min-value` (default $1, marked `skipped: dust`).
5. Positions above `--max-value` if set (no default — uncapped; marked `skipped: above_max`).
6. All non-wallet positions — `deposit`, `loan`, `staked`, `locked`, `reward`, `investment`. These never appear in the plan.

`--include <symbols>` overrides exclusions 2 and 3 (still subject to dust). `--exclude <symbols>` adds further symbol exclusions.

## Stables behavior

| Context | Result |
|---|---|
| `--include-stables` set | Include, no prompt. |
| `--exclude-stables` set | Exclude, no prompt. |
| Neither set, TTY | Prompt: `Include stables (USDC/USDT/USDS/...) in this sweep? [y/N]` (default No). |
| Neither set, non-TTY (pipe / agent invocation) | Default to **exclude**, no prompt — agents never block on stdin. |

## Native gas-token handling

`--include-native` sweeps the chain's native currency too (e.g. ETH on base, SOL on solana, POL on polygon). Pair with `--gas-reserve <amount>` to leave a buffer for future txns; otherwise the per-chain default applies:

| Chain | Default reserve |
|---|---|
| ethereum | 0.005 ETH |
| base | 0.001 ETH |
| arbitrum | 0.001 ETH |
| optimism | 0.001 ETH |
| polygon | 1 POL |
| binance-smart-chain | 0.005 BNB |
| avalanche | 0.05 AVAX |
| gnosis | 1 xDAI |
| scroll | 0.001 ETH |
| linea | 0.001 ETH |
| zksync-era | 0.001 ETH |
| zora | 0.001 ETH |
| blast | 0.001 ETH |
| solana | 0.01 SOL |
| _other_ | 0.01 (with stderr warning — set `--gas-reserve` explicitly) |

`--gas-reserve` without `--include-native` errors with `conflicting_flags`. If the reserve is ≥ the position quantity, the row is marked `skipped: below_reserve`.

## Safety

- **Dry-run by default.** No signing happens without `--execute`. Always run the bare command first and read the plan before broadcasting.
- **Native token excluded by default.** Gas reserve protection only kicks in when you explicitly pass `--include-native`. Without it, the native row is silently filtered out — your ETH/SOL stays put.
- **Stables excluded by default in non-TTY contexts.** Agents and pipelines never auto-sweep stables without an explicit `--include-stables` flag.
- **Max-loss filter is a backstop, not a cap.** A row marked `blocked: max_loss` will NOT be broadcast even with `--execute`. Tighten the filter for low-liquidity tokens with `--max-loss 2`.
- **Sequential broadcast — no atomicity, regardless of `--concurrency`.** Plan-phase quote fetches may run in parallel (paid keys), but the `--execute` broadcast phase is always serial — parallel signed broadcasts would race EVM nonces. Each row's swap is an independent on-chain transaction.
- **Partial success is the only mode.** Per-row failures during `--execute` are recorded with their full error string and the batch continues to the next row — one failing quote does not gate the rest of a sweep. The final result lists which tokens succeeded and which failed under a `Failures:` block; correlate by symbol back to the table above.
- **Quotes are taken from the plan phase, not re-fetched on `--execute`.** The execute path broadcasts the same quotes the plan just showed you, so the operator's read of the plan is what's signed. Staleness is bounded by `--slippage` and the on-chain `outputMin` returned by the quote API. Treat `--execute` as a commitment to broadcast every ready row.
- **`loss_pct` reports the quote's expected loss, not the on-chain floor.** Realized output is bounded below by `outputMin` (= `minimum_output_amount.quantity`), which sits ~`--slippage`% below the expected output. A row at `loss_pct = 4.9%` with default `--slippage 2` can land at ~6.9% realized loss. Tighten `--max-loss` for low-liquidity sweeps.
- **One passphrase prompt for the whole batch.** The agent token is read once up-front; if you abort mid-batch, the remaining swaps will simply not run.

## Common errors

| Code | Cause | Fix |
|---|---|---|
| `missing_args` | `<chain>` or `<to-token>` missing | `zerion consolidate base USDC` |
| `unsupported_chain` | Invalid chain | `zerion chains` |
| `target_token_not_found` | Target is neither a curated symbol on this chain nor a contract address | Pass a contract address (`0x…` / Solana base58), or use one of the curated symbols named in the error |
| `invalid_min_value` | `--min-value` is NaN or negative | Pass a non-negative number, e.g. `--min-value 1` |
| `invalid_max_value` | `--max-value` is NaN, zero, or negative | Pass a positive number, e.g. `--max-value 10` |
| `invalid_max_loss` | `--max-loss` is NaN, negative, or > 100 | Use percent (`5`) or fraction (`0.05`); see Dual form above |
| `invalid_gas_reserve` | `--gas-reserve` is NaN or negative | Pass a non-negative native-units number |
| `invalid_concurrency` | `--concurrency` is NaN, non-integer, < 1, or > 10 | Pass an integer in `1..10`, e.g. `--concurrency 5` |
| `conflicting_flags` | `--gas-reserve` without `--include-native`, `--include-stables` with `--exclude-stables`, or `--max-value < --min-value` | Pass `--include-native` to opt in, pick one stables flag, or widen the band |
| `invalid_flag_value` | Bare boolean flag got a non-positional consumed as value | Pass the boolean flag last, or use `--flag=true` / `--no-flag` |
| `invalid_slippage` | `--slippage` not in 0–100 | `--slippage 2` |
| `no_agent_token` | Trading needs an agent token | See `capabilities/agent-management.md` |
| `insufficient_funds` | A row's balance dropped between quote and broadcast | Refresh and re-run `--execute` |

## AI prompt examples

How common natural-language requests map to invocations.

| User prompt | Invocation |
|---|---|
| `clear dust tokens on base for default wallet` | `zerion consolidate base USDC --max-value 10` (sweep rows up to $10; main bags above $10 stay put. `--min-value` defaults to $1 so genuinely-tiny rows still skip as `dust`.) |
| `consolidate everything on arbitrum into USDC` | `zerion consolidate arbitrum USDC` (dry-run first, then re-run with `--execute`) |
| `sweep dust on polygon into USDC including the small stables` | `zerion consolidate polygon USDC --include-stables --max-value 10` |
| `convert all my base tokens to ETH and keep some for gas` | `zerion consolidate base ETH --include-native --gas-reserve 0.002` |
| `dust cleanup on optimism but be conservative on slippage` | `zerion consolidate optimism USDC --max-value 10 --max-loss 2 --slippage 1` |
| `treasury sweep on ethereum into USDC for wallet treasury-1` | `zerion consolidate ethereum USDC --wallet treasury-1` |
| `consolidate solana wallet into SOL` | `zerion consolidate solana SOL --include-native` |
| `move all my polygon tokens to <0x…>` | `zerion consolidate polygon 0x… ` (curated symbols don't cover this token; pass the address) |
| `clear dust but skip WETH and WBTC` | `zerion consolidate base USDC --exclude WETH,WBTC --max-value 10` |
| `sweep only mid-size positions on base ($5–$50) into USDC` | `zerion consolidate base USDC --min-value 5 --max-value 50` (band: rows below $5 → `dust`, above $50 → `above_max`) |

Always start in dry-run (omit `--execute`) so the operator can read the plan before broadcasting. Surface the totals line (`N ready, M blocked, K skipped`) before suggesting `--execute`.

## Pair with

- `capabilities/analyze.md` — inspect positions before sweeping. Useful to spot the long tail of dust and decide on `--min-value`.
- `capabilities/trading.md` — the underlying same-chain swap primitive. Use it for one-off conversions; use `zerion-consolidate` when you want to sweep many at once.
- `capabilities/agent-management.md` — set up the agent token + policies the `--execute` path will use.
