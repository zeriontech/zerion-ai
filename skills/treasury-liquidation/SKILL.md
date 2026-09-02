---
name: treasury-liquidation
description: Move and liquidate crypto treasury holdings across many chains with the zerion CLI. Two composable phases - (1) drain every token above a floor from one wallet to another across all chains via raw transfers, preserving asset identity, and (2) convert a wallet's entire multi-chain portfolio into USDC on one destination chain, keeping a gas reserve on each chain. Use when asked to drain, sweep, consolidate, liquidate, or "send everything" / "swap everything into USDC" for a wallet, to move a treasury between addresses, or to clean up dust and long-tail tokens across chains.
---

# Treasury liquidation

Two phases. They compose (drain A→B, then liquidate B) or run independently.

**Phase 1 — drain.** Send every token above a floor from wallet A to wallet B,
across all chains, as raw transfers. No swaps, so asset identity and cost basis
survive; the sale can happen later in B. `scripts/drain.py`

**Phase 2 — liquidate.** Convert a wallet's whole multi-chain portfolio into USDC
on one destination chain, keeping a gas reserve everywhere. `scripts/liquidate.py`

Read `references/gotchas.md` before the first run of a session. It documents
failure modes that are silent, expensive, and not inferable from the CLI's output.

## Always do these

1. **Preflight auth.** `scripts/preflight.py --wallet "<name>"`. An invalid API key
   makes every CLI command hang forever with no error, and expired policies block
   all writes. Both are ~1 minute to check and hours to debug.
2. **Run batches detached.** `nohup python3 -u scripts/<x>.py … > run.log 2>&1 &`,
   then poll the log. A tool-call timeout kills a batch mid-flight while broadcast
   transactions still land.
3. **Verify on-chain, not from CLI output.** `scripts/verify.py --address 0x…`.
   A hung command is indistinguishable from a working one; equal `latest`/`pending`
   nonces prove nothing was sent.
4. **Report failures honestly.** Partial success is the normal outcome. Give counts
   by failure code and name what was left behind and why.

## Workflow

### 0. Inventory

```bash
scripts/inventory.py --address 0x… --min-value 1
```

Separates real wallet tokens from DeFi positions, groups by chain, marks
unreachable chains, and flags broken price feeds. **Its totals — not
`zerion portfolio` — are the ones to quote.** Portfolio totals routinely include
4000x-wrong price rows and double-counted DeFi underlyings.

### 1. Drain (optional)

```bash
scripts/drain.py --from <wallet> --to 0x… --min-value 1 --dry-run   # review
nohup python3 -u scripts/drain.py --from <wallet> --to 0x… > drain.log 2>&1 &
```

Sends ERC-20s first and native last on each chain (native pays the gas), shaves
0.1% off ERC-20 amounts, holds back a per-chain gas reserve, and skips rows that
cannot succeed: duplicate symbols on one chain (sends resolve by symbol and would
hit the wrong contract) and blank symbols.

Expect ~80% success. The residue is spam tokens whose symbols collide with real
holdings — irreducible while `send` has no contract-address argument.

### 2. Liquidate

```bash
scripts/liquidate.py --wallet "<name>" --plan-only          # review
nohup python3 -u scripts/liquidate.py --wallet "<name>" > liq.log 2>&1 &
```

Four stages, `--stages ABCD` to run a subset:

| | Stage | Why here |
|---|---|---|
| A | sweep each chain's ERC-20s → that chain's USDC (WETH where no USDC exists) | before native, which pays for it |
| B | bridge that USDC → destination | |
| C | bridge each chain's **native** → destination USDC, minus reserve | one hop, half the fees of swap-then-bridge |
| D | destination chain: sweep ERC-20s, then swap native minus reserve | last, so gas exists throughout |

`--dest` defaults to `ethereum`. Stage C is the one most easily forgotten and
usually the largest: `consolidate` **silently** drops native rows without
`--include-native`, so a sweep can look complete while every chain's ETH sits
untouched.

**Gas is the binding constraint, not the quotes.** Two failure modes follow from
that, and the scripts now guard both:

- **Stage A reserves gas for the stage-B bridge that must follow it.** Every swap
  spends native, and stage B then needs one more transaction to bridge the proceeds
  out. Sweeping a chain until its gas runs out converts sellable tokens into an
  *unsendable* pile of USDC/WETH. `gas.affordable_swaps()` caps each chain's sweep
  at what it can fund while still paying for the bridge; surplus rows are deferred
  lowest-value-first and logged, and a chain that cannot fund even one bridge is
  skipped up front with a top-up hint. Calibrated on a real run where 44 swaps on
  `robinhood` ate $12 of ETH (~$0.27 each) and stranded $1,893 of WETH behind them.
- **The reserve is USD-aware.** A native-unit reserve is worth cents on cheap chains
  (1 POL ≈ $0.20, 1 S ≈ $0.03), so a chain would pass the old flat "$5 of balance"
  test, bridge nearly everything away, and be left unable to broadcast anything.
  `reserve_for(chain, price)` keeps the larger of the native figure and
  `MIN_RESERVE_USD` ($2.50), and stage C applies its `MIN_BRIDGE_USD` floor to the
  amount *actually leaving* rather than to the pre-reserve balance.

The cost of both guards is a few dollars of gas retained per chain. That is the
intended trade: a chain with gas can be retried, a chain without gas cannot.

### 3. Verify and report

```bash
scripts/verify.py --address 0x…
scripts/inventory.py --address 0x… --min-value 5     # what's left
```

Report the on-chain destination balance, then itemize the remainder split into
**unreachable** (no trading/bridging on that chain), **uneconomic** (fees exceed
value, or quotes show >50% loss), and **DeFi** (needs protocol withdrawal).

## What this cannot do

- **Withdraw DeFi positions.** The CLI has no withdraw/unstake/redeem/claim
  command, and receipt tokens (`aArbLINK`, `eETH`, `cETH`, `pufETH`, `sOHM`, `DPI`…)
  have no swap route — verified, they quote ~$0 or `no_route`. Route the user to
  the Zerion web app (`zerion wallet sync --wallet <name>`) or each protocol's UI.
- **Sign for a wallet not in the local vault.** `zerion wallet list` is the whole
  set. Without the key, nothing moves.
- **Reach `aurora`, `polygon-zkevm`, `okbchain`, `degen`.** Indexed but not
  tradeable or bridgeable; needs a manual bridge.
- **Create an agent token.** Needs a real TTY — the user must run `create-token` in
  their own terminal. `create-policy` is agent-runnable.

## Decisions worth surfacing before executing

- **Drain-then-liquidate vs liquidate-in-place.** Draining raw preserves cost basis
  and puts the taxable event in the destination wallet; consolidating first inverts
  that. If the user has previously chosen a two-phase shape "for accounting
  reasons", don't quietly collapse it.
- **The gas reserve.** "Swap all of it" and "leave the wallet able to transact" are
  in tension. Keep a reserve by default (`scripts/gas.py`), state the amount, and
  offer to zero it.
- **The dust floor.** Below ~$2 fees exceed the balance. Say what is being skipped
  and its total rather than silently dropping it.
