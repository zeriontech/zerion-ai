# Zerion CLI gotchas

Behaviors learned from real multi-chain liquidations. Each cost real money or hours.

- [Auth](#auth)
- [Silent filters and wrong numbers](#silent-filters-and-wrong-numbers)
- [Quotes that lie](#quotes-that-lie)
- [Sends](#sends)
- [Bridges](#bridges)
- [Chain support](#chain-support)
- [Execution mechanics](#execution-mechanics)

## Auth

**An invalid or revoked API key makes the CLI HANG FOREVER.** No error, no timeout,
no output — reads included. Diagnosing this from CLI behavior alone is impossible.

`ZERION_API_KEY` in the environment **overrides `~/.zerion/config.json`**, and an
already-running shell keeps exporting whatever it started with, so editing
`config.json` and `~/.zshrc` fixes nothing for the current session. Rotating a key
mid-session breaks everything already running.

Confirm over raw HTTP, which fails fast:

```bash
curl -sL -H "Authorization: Basic $(printf '%s:' "$KEY" | base64)" \
  https://api.zerion.io/v1/chains/ -o /dev/null -w '%{http_code}\n'
```

200 from curl while the CLI hangs = stale env key. Fix by prefixing every call:
`ZERION_API_KEY=<new> zerion …`. Shell state does not persist between agent tool
calls, so prefix *each* one. (API paths need no trailing slash — a trailing `/`
returns a 301 that `curl` won't follow without `-L`.)

**`agent create-token` requires a real TTY.** It fails with "Passphrase must be
entered in an interactive terminal" from an agent shell *and* from Claude Code's
`!` prefix. Only the user, in their own terminal window, can create one.
`create-policy` and `use-token` need no passphrase and are agent-runnable.

**Policies expire and block writes before broadcast** with
`policy denied: policy expired at …`. Costs nothing but blocks everything. Check
expiry before planning a long run. `--deny-transfers` blocks only *native*
transfers, not ERC-20 sends.

## Silent filters and wrong numbers

**`consolidate` excludes the native gas token by default and says nothing about
it.** No warning, no skipped row in the output — the balance simply stays put. A
sweep can report "233 swaps succeeded" while every chain's ETH is untouched. Pass
`--include-native` (with `--gas-reserve`), or handle native separately. This is
the single easiest way to silently leave five figures behind.

Stablecoins are likewise excluded unless `--include-stables` is passed (non-TTY
contexts default to excluding, without prompting).

**`zerion positions` re-lists DeFi underlyings as if they were wallet tokens.** An
Aave deposit shows both `aArbLINK` (the receipt token, genuinely held) *and* `LINK`
(the underlying, not held) at byte-identical quantities. Index Coop baskets surface
their constituents the same way. Sweeping those phantom rows makes `transferFrom`
revert on-chain — more than half the swaps in one Ethereum run failed this way.

The raw API carries `position_type`, so the distinction is unambiguous:

```
GET /v1/wallets/<addr>/positions?page[size]=100   →  attributes.position_type
```

Filter to `wallet` client-side. (A `filter[position_types]=wallet` query param
returns zero rows — don't use it.)

**Price feeds can be catastrophically wrong.** One run priced a staked-governance
token at roughly 4000x its real value — enough that a single row dominated the
reported portfolio total. Never quote a portfolio total without sanity-checking any
row above ~25% of the book.

**A sweep that exhausts a chain's gas strands its own proceeds.** `consolidate`
happily swaps until the native balance is gone, and the bridge that has to follow
then fails `not_enough_base_asset_balance`. The tokens have been converted but
cannot leave — strictly worse than not sweeping, because the original assets are
gone too. Seen twice: 44 swaps on `robinhood` spent $12 of ETH (~$0.27 each) and
left $1,893 of WETH unbridgeable; a `polygon` sweep attempted 3 swaps holding
$0.00 of POL. Budget gas for `swaps + 1 bridge` *before* sweeping, not after.

**A native-unit gas reserve is worth cents on cheap chains.** 1 POL ≈ $0.20,
1 XDAI ≈ $1.00, 1 S ≈ $0.03. Combined with a flat "skip if balance < $5" test, a
chain passes the check, bridges nearly everything home, and is left holding a
reserve too small to broadcast anything — so any residue there is stranded until a
manual top-up. Size reserves in USD, and apply the bridge floor to the amount
actually leaving (balance minus reserve), not to the balance before it.

**The positions indexer lags fresh deposits by minutes.** A bridge reported
`delivery=delivered` and `eth_getBalance` showed 132 POL on-chain while the
positions API still returned $0.00 native for that chain — which made a
gas-affordability check false-skip the whole chain moments after it had been
deliberately topped up. Cuts the other way too: quantities read from `positions`
right after a batch of swaps miss the proceeds (a bridge sized from that read
carried $3 instead of $100). After any top-up or sweep, confirm via RPC before
acting on an indexer read.

**Trust on-chain balances over everything.** `eth_getBalance` for native,
`eth_call` + `0x70a08231<padded addr>` for ERC-20. Use
`https://ethereum-rpc.publicnode.com` (llamarpc 521s, cloudflare-eth errors).

## Quotes that lie

**`consolidate` has no max-GAIN filter.** Broken or illiquid tokens return absurd
quotes — multiples of 2,716x and 146,000x the input have both been seen. They pass the
max-LOSS check as `ready`. On-chain `outputMin` makes them revert, so no funds are
lost, but gas is. **Pre-filter anything quoting above ~2x expected value.**

Absurd quotes are **not stable between runs** — `X` was 146,000x one session and
priced normally the next, while `ACH` went the other way. Recompute the exclusion
list from a fresh dry-run every time; never reuse a saved list.

**DeFi receipt tokens have no swap route.** `aArbLINK`, `eETH`, `cETH`, `sETH2`,
`aSTETH`, `pufETH`, `ETHx`, `ankrETH`, `yvBOOST`, `DPI`, `sOHM` all quote ~$0 output
or `no_route`. Their value is real but only a **protocol withdrawal** (Zerion web
app, or the protocol's own UI) frees it. Exclude them from sweeps.

**`--execute` re-plans and re-quotes.** The plan just read is not what gets
broadcast; rows that were `ready` can vanish (`"No ready rows to execute."`) or
newly appear. Re-check afterwards rather than trusting the earlier plan.

**`loss_pct` is the expected loss, not the floor.** Realized output is bounded by
`outputMin`, roughly `--slippage` below expected. A row at 4.9% loss with 2%
slippage can land at ~6.9%.

Default `--max-loss` is 5%, which blocks genuinely-worthwhile rows on illiquid
chains. Raising to ~12% can recover meaningful value; check the ratios first.

## Sends

**No "send max".** `send` needs an explicit amount, and sending the indexer's full
quantity fails `insufficient_balance` (have ≈ need) because the indexer rounds up
past real wei. **Shave 0.1% (`qty * 0.999`).**

**Sends resolve BY SYMBOL, and positions carry no contract address.** Two tokens
sharing a symbol on one chain both resolve to the wrong contract (`have 0`). Skip
any symbol appearing more than once per chain — it is unrecoverable via `send`.

**Blank symbols produce `zerion send "" …` → `missing_args`.** Filter empty and
whitespace-only symbols when generating commands.

**Send native LAST on each chain.** It pays the gas; sending it first strands every
remaining ERC-20 on that chain.

The old "intrinsic gas too low" native-send bug (hardcoded 21000 gas) appears
**fixed as of v1.8.0** — robinhood, base, megaeth, and Ethereum native sends all
succeeded where they previously failed.

## Bridges

**Bare `zerion bridge` AUTO-EXECUTES when only one provider offers a route.** It
only lists-and-exits on multi-offer pairs. There is no `--dry-run` and no safe
read-only probe — treat *any* bridge invocation as a commitment to move funds. To
test reachability without signing, run `zerion consolidate <chain> <token>` (always
dry-run by default) and read the error code.

`--cheapest` executes the highest-output route deterministically; prefer it over
the bare form so behavior doesn't depend on how many providers happen to quote.

**`delivery=timeout` usually still lands.** The source transaction succeeded and
the poll window simply expired. Confirm by checking the source chain drained rather
than re-sending — a blind retry double-bridges.

**Transient failures are common and usually succeed on retry:**
`broadcast_failed: Transaction broadcast failed`, RPC errors, `HTTP request failed`.
Build in one automatic retry. One AVAX bridge failed twice and worked on the third.

**Bridge native straight to destination USDC** (`bridge <chain> ETH <amt> ethereum
USDC`) rather than swapping to USDC locally then bridging — one hop, half the fees.

Below roughly $2–5 the bridge fee consumes the whole transfer; a sub-$20 position
can lose ~30% of its value in fees.

## Chain support

Support is three independent capabilities — indexed, tradeable, bridgeable — and a
chain can have any subset. The authoritative probe is a `consolidate` dry-run:

| Signal | Meaning |
|---|---|
| `chain_capability_missing` | no trading (error names the supported chains) |
| `target_token_not_found` | trades, but no USDC implementation — target `WETH` instead |
| valid plan returned | tradeable |

Bridging is separate and has its own `chain_capability_missing`.

Observed (re-verify; the CLI's chain list grows):

- **No trading or bridging:** `aurora`, `polygon-zkevm`, `okbchain`, `degen`.
  Value here needs a manual bridge through the chain's own UI.
- **No USDC implementation:** `robinhood`, `blast`, `megaeth` → sweep to `WETH`,
  then bridge WETH → destination USDC.
- **`celo` is effectively broken:** every send failed `broadcast_failed`, and
  bridges failed with "Base asset balance is not enough to cover network fee"
  despite a funded CELO balance on that chain.
- **`gnosis` vs `xdai`:** analytics says `xdai`; the send engine rejects `gnosis`.

## Execution mechanics

**Run long batches detached** (`nohup … &`). A sweep is hundreds of sequential
confirmations; a wrapper timeout kills it mid-batch while already-broadcast
transactions still land, leaving state ambiguous.

**Never infer success from process liveness.** A hung command looks exactly like a
working one. Check the output, then check the chain.

**zsh does not word-split unquoted `$var`.** `for a in "base USDC 5 ethereum USDC";
do zerion bridge $a; done` passes one argument and fails `missing_args`. Use `"$@"`,
`${=a}`, or emit one full command per line.

**Parse output with `raw_decode`, not `json.loads`.** Commands print human lines
("Broadcasting…", "Tx hash: …") before the JSON, sometimes with trailing text:

```python
i = out.find("{")
data = json.JSONDecoder().raw_decode(out[i:])[0]
```

**`consolidate --execute` is sequential** regardless of `--concurrency`, which only
affects plan-phase quote fetching (paid keys → 5, `zk_dev_` keys → 1).
