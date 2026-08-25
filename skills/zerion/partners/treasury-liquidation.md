
# Zerion — Treasury Liquidation

Move and liquidate a multi-chain treasury: drain every token above a floor from one
wallet to another, and/or convert a wallet's entire cross-chain portfolio into a
single stablecoin on a single chain. Built on `send`, `consolidate`, `swap` and
`bridge`; this doc is the ordering and the flag choices that make a large run land
predictably.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the parent `SKILL.md` (Setup + Authentication).
**Every phase here writes on-chain, so an API key + agent token is required** —
pay-per-call does not apply.

## When to use

- "Send everything from wallet A to wallet B"
- "Swap all my tokens into USDC on Ethereum"
- "Consolidate the treasury onto one chain"
- "Clean up the long tail across every chain"
- Any drain / sweep / liquidate request spanning more than one or two chains

For a single chain, use `partners/consolidate.md` directly. For one-off conversions
see `capabilities/trading.md`. For balance inspection first, `capabilities/analyze.md`.

## The two phases

They compose (drain A→B, then liquidate B) or run independently.

| Phase | What | Preserves |
|---|---|---|
| 1 — Drain | raw `send` of every token above a floor, A → B, all chains | asset identity and cost basis; the sale can happen later in B |
| 2 — Liquidate | `consolidate` + `bridge` into one target token on one chain | nothing — everything becomes the target token |

Choosing between them is an accounting decision, not a technical one. Draining raw
keeps each asset intact and puts any future taxable event in the destination wallet;
liquidating first realises it in the source wallet. **Ask which is wanted** rather
than assuming — the technically simpler path (liquidate in place) is often the wrong
one for the operator.

## Phase 1 — drain

One `send` per position. There is no "send max", so each amount is explicit.

```bash
zerion send <token> <amount> --to <address> --chain <chain> --wallet <source>
```

Three rules make the difference between ~80% and ~30% success:

**Send the native gas token LAST on every chain.** It pays for the transactions
before it. Sending it first strands every remaining ERC-20 on that chain, and
recovering them then needs a manual top-up.

**Hold back a gas reserve** from the native amount — enough for several more
transactions on that chain. Suggested starting points: `0.005` ETH on ethereum,
`0.0008` on ETH-denominated L2s, `1` POL, `0.03` AVAX, `0.004` BNB.

**Shave ~0.1% off ERC-20 amounts** (`quantity * 0.999`). Indexed quantities round up
past the real wei balance, so sending the displayed figure fails
`insufficient_balance` with have ≈ need.

Two classes of position cannot be sent and are worth filtering out before you start,
so they don't look like failures later:

- **Duplicate symbols on one chain.** `send` resolves tokens by symbol, so when two
  tokens share one (common with airdrop spam), the transfer targets the wrong
  contract and fails `have 0`. Skip any symbol appearing more than once per chain.
- **Empty symbols.** Some positions carry no symbol; they cannot be addressed.

Expect partial success on a wallet with a long spam tail. Report the failures by
error code rather than as a single count — the operator needs to know whether value
was left behind or only dust.

## Phase 2 — liquidate

Four stages. The order exists because each stage spends gas the next one needs.

### A. Sweep each chain's ERC-20s into that chain's target token

```bash
zerion consolidate <chain> USDC --wallet <w> --include-stables --min-value 1 --execute
```

Run the bare command first and read the plan. Pass `--include-stables` or existing
stablecoin balances stay put (non-TTY contexts default to excluding them).

On chains with no USDC implementation, target `WETH` instead and bridge that in
stage B. A `consolidate` dry-run tells you which case you're in: `target_token_not_found`
means the chain trades but has no USDC; `chain_capability_missing` means no trading
at all, and the error names the chains that do work. Value on a non-trading chain
needs a manual bridge and should be reported as unreachable rather than retried.

Sanity-check the plan before executing. A quote whose `expected_output_usd` is a
large multiple of `value_usd` will not deliver that — it reverts against `outputMin`
on-chain and costs gas. Exclude those rows with `--exclude`, and recompute the list
each run rather than reusing a saved one; quotes move.

### B. Bridge the resulting balances to the destination chain

```bash
zerion bridge <chain> USDC <amount> <dest> USDC --wallet <w> --cheapest --timeout 300
```

Shave 0.1% here too. Below roughly $2–5 the bridge fee consumes the whole transfer,
so set a floor and report what falls under it.

Pass `--cheapest` (or `--fast`) explicitly. Without a strategy flag the command
lists offers and exits when several providers quote, but **auto-executes when only
one does** — so the bare form's behaviour depends on market conditions. Being
explicit makes the run deterministic. There is no `--dry-run` for `bridge`; to test
whether a chain is reachable without signing, use a `consolidate` dry-run instead.

Transient `broadcast_failed` and RPC errors are worth one automatic retry — they
usually succeed on the second attempt. A `delivery=timeout` with a successful `tx`
generally means the poll window expired rather than the bridge failing; confirm by
checking the source chain drained before re-sending, so you don't bridge twice.

### C. Bridge native gas tokens to the destination

```bash
zerion bridge <chain> ETH <amount-minus-reserve> <dest> USDC --wallet <w> --cheapest
```

Native goes straight to the destination token in one hop — cheaper than swapping to
USDC locally and bridging that.

**`consolidate` excludes the native gas token by default**, so stages A and B leave
every chain's ETH, BNB, POL and so on untouched. Either pass `--include-native`
(with `--gas-reserve`) in stage A, or handle native here. On a wallet spread across
many chains this is frequently the largest single component of the sweep, and it is
easy to miss because the swept rows all report success without it.

### D. Finish on the destination chain

Sweep the destination chain's own ERC-20s, then swap its native balance last, minus
a reserve:

```bash
zerion consolidate <dest> USDC --wallet <w> --include-stables --execute
zerion swap <dest> <amount-minus-reserve> ETH USDC --wallet <w> --slippage 0.5
```

Keep the reserve. "Swap all of it" and "leave the wallet able to transact" are in
tension; a wallet with zero gas cannot move anything afterwards. State the amount
held back rather than silently keeping it.

For a deep pair like ETH/USDC, tighter slippage than the 2% default is usually safe
and saves real money on a large swap.

## Reading balances accurately

Two habits prevent a wrong report at the end.

**Separate wallet positions from DeFi positions.** `positions` lists the underlying
assets of protocol positions alongside genuinely-held tokens — an Aave deposit's
underlying, an index token's constituents. Those underlyings are not transferable or
swappable from the wallet, and including them inflates both the plan and the total.
The API exposes `attributes.position_type` on each row; filter to `wallet`:

```
GET /v1/wallets/<addr>/positions?page[size]=100
```

**Verify large balances on-chain.** Indexed prices are occasionally wrong by orders
of magnitude, and one bad row can dominate a portfolio total. Before quoting a
figure, check it: `eth_getBalance` for native, `eth_call` with
`0x70a08231<32-byte-padded address>` for an ERC-20.

## DeFi positions

Protocol positions are **out of scope for this flow**. `consolidate` and `swap`
operate on wallet tokens; receipt tokens (aTokens, cTokens, LST and LRT receipts,
index tokens, vault shares) generally have no direct swap route, so attempting to
sweep them costs gas and returns nothing.

Unwind them first through the protocol — the Zerion app's DeFi view covers most, and
`zerion wallet sync --wallet <name>` pushes the wallet there — then run phase 2 over
the proceeds.

## Running a large batch

- **Run detached.** A full treasury run is hundreds of sequential confirmations. A
  wrapper timeout that kills it mid-batch leaves already-broadcast transactions to
  land anyway, which makes the resulting state ambiguous.
- **Confirm the agent token's policy outlives the run.** An expired policy blocks
  every write with `policy denied`, costing nothing but halting everything.
  `agent create-policy` is scriptable; `agent create-token` needs an interactive
  terminal for the passphrase.
- **Partial success is normal.** Report it as such: what succeeded, what failed and
  why, and what was deliberately skipped with its total. A bare success count hides
  the interesting half.

## Common errors

| Code | Cause | Fix |
|---|---|---|
| `chain_capability_missing` | chain has no trading (or no bridging) | unreachable via CLI; bridge manually |
| `target_token_not_found` | chain trades but the target has no implementation there | target `WETH`, bridge in stage B |
| `insufficient_balance` | amount above real balance, or symbol resolved to another contract | shave 0.1%; skip duplicate symbols |
| `policy denied: policy expired` | agent policy lapsed | create a fresh policy and token |
| `broadcast_failed` | transient RPC/broadcast failure | retry once |
| `no_agent_token` | writes need a token | see `capabilities/agent-management.md` |

## AI prompt examples

| User prompt | Flow |
|---|---|
| `send everything from A to B` | phase 1, `--min-value 1`, native last per chain |
| `swap everything into USDC on Ethereum` | phase 2, stages A→D |
| `move the treasury to a new wallet and cash out` | phase 1, then phase 2 on the destination |
| `consolidate but keep my ETH` | phase 2, stages A and B only |
| `clean up dust everywhere` | phase 2 with `--max-value` on the sweeps |

Always dry-run first and surface the plan totals — including what is unreachable —
before broadcasting.

## Pair with

- `partners/consolidate.md` — the single-chain sweep this builds on
- `capabilities/trading.md` — `swap`, `bridge`, `send` reference
- `capabilities/analyze.md` — balances and positions before you start
- `capabilities/agent-management.md` — tokens and policies for unattended runs
