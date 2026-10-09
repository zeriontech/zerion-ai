#!/usr/bin/env python3
"""PHASE 2 -- convert everything in one wallet into USDC on a single chain.

Four stages, in this order for a reason:
  A  sweep each chain's ERC-20s into that chain's USDC (WETH where no USDC exists)
  B  bridge that USDC to the destination chain
  C  bridge each chain's NATIVE token straight to destination USDC, minus a gas
     reserve -- one hop, half the fees of swap-then-bridge
  D  on the destination chain: sweep ERC-20s, then swap native minus reserve

Native goes last everywhere because it pays for the transactions before it.

Usage:
    liquidate.py --wallet "<wallet-name>" [--dest ethereum] [--min-value 1]
    liquidate.py --wallet "<wallet-name>" --plan-only
    liquidate.py --wallet "<wallet-name>" --stages CD

Run detached (nohup). A full run is hundreds of sequential confirmations.
"""
import argparse, json, os, subprocess, sys, time
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inventory import fetch, norm, key, NO_TRADE, NO_USDC  # noqa: E402
from gas import (  # noqa: E402
    reserve_for, reserve_usd, affordable_swaps, bridge_gas_usd, MIN_RESERVE_USD,
)

# Receipt tokens for DeFi positions. They quote at ~0 output or no_route, and
# swapping them reverts on-chain. Only a protocol withdrawal frees this value.
DEFI_RECEIPTS = {
    "AARBLINK", "ALINK", "AUSDT", "ASTETH", "AETH", "AETHWBTC", "AETHWETH", "STKAAVE",
    "CETH", "EETH", "SETH2", "RETH2", "PUFETH", "ETHX", "ANKRETH", "RSETH", "RSWETH",
    "SWETH", "STETH", "OETH", "YVBOOST", "YVECRV-DAO", "SOHM", "XSUSHI", "UNI-V2",
    "3CRV", "SBTCCRV", "DPI", "MVI", "BTC2X-FLI", "ETH2X-FLI",
}
MAX_GAIN = 2.0   # quotes above this multiple are the known absurd-quote bug
# Below this, a bridge's fee consumes the transfer. Applied to the amount actually
# leaving the chain (balance minus gas reserve), never to the raw balance.
MIN_BRIDGE_USD = 5.0


def run(args, timeout=1800):
    env = dict(os.environ, ZERION_API_KEY=key())
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        out = p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        return {"error": {"code": "local_timeout"}}
    i = out.find("{")
    if i < 0:
        return {"error": {"code": "no_json", "message": out[:200]}}
    try:
        return json.JSONDecoder().raw_decode(out[i:])[0]
    except Exception:
        return {"error": {"code": "unparseable", "message": out[:200]}}


def log(m):
    print(m, flush=True)


def chains_with_value(wallet_addr, min_value, dest):
    rows = [p for p in norm(fetch(wallet_addr, key()))
            if p["type"] == "wallet" and p["value"] >= min_value]
    out = {}
    for p in rows:
        out.setdefault(p["chain"], []).append(p)
    return {c: v for c, v in out.items() if c not in NO_TRADE}


def target_for(chain):
    return "WETH" if chain in NO_USDC else "USDC"


def native_of(chain, rows):
    """The chain's native row, which carries both its balance and its USD price."""
    for p in rows:
        if p["chain"] == chain and p["native"] and p["type"] == "wallet":
            return p
    return None


def stage_a(wallet, chains, dest, min_value):
    """Sweep ERC-20s per chain. Native excluded here -- stage C handles it.

    Gas is the binding constraint, not the quotes. Each swap spends the chain's
    native token, and stage B then needs one more transaction to bridge the
    proceeds out. Sweeping until the gas runs out therefore converts sellable
    tokens into an unsendable pile of USDC/WETH -- observed twice, once stranding
    $1.9k of WETH on a chain with $0 of gas left.

    So the sweep is capped at what the chain can afford while still funding the
    follow-on bridge.
    """
    log("\n===== STAGE A: per-chain ERC-20 sweep =====")
    for ch in [c for c in chains if c != dest]:
        tgt = target_for(ch)
        nat = native_of(ch, chains.get(ch, []))
        native_usd = (nat or {}).get("value") or 0.0
        budget = affordable_swaps(ch, native_usd)
        if budget < 1:
            # The figure comes from the positions indexer, which lags a fresh
            # top-up by minutes: a bridge can deliver native on-chain while this
            # still reads $0.00. Before trusting a zero, check eth_getBalance.
            log(f"{ch}: SKIPPED -- gas ${native_usd:,.2f} cannot fund a sweep plus "
                f"the bridge that must follow (needs > ${bridge_gas_usd(ch):.2f}). "
                f"Top up native on {ch} to recover this chain (if you just did, "
                f"the indexer may not have caught up -- verify via RPC and rerun).")
            continue

        plan = run(["zerion", "consolidate", ch, tgt, "--wallet", wallet,
                    "--include-stables", "--min-value", str(min_value)])
        if plan.get("error"):
            log(f"{ch}: plan failed {plan['error'].get('code')}")
            continue
        excl = set()
        ready = []
        for r in plan.get("rows", []):
            if r.get("status") != "ready":
                continue
            v, o = r.get("value_usd") or 0, r.get("expected_output_usd") or 0
            if r["symbol"].upper() in DEFI_RECEIPTS or (v > 0 and o / v > MAX_GAIN):
                excl.add(r["symbol"])
            else:
                ready.append(r)
        if not ready:
            log(f"{ch}: nothing sweepable")
            continue

        # Not enough gas for every row: keep the most valuable ones and raise
        # --min-value to drop the rest, rather than sweeping until gas runs out.
        eff_min = min_value
        dropped = 0
        if len(ready) > budget:
            ready.sort(key=lambda r: -(r.get("value_usd") or 0))
            keep, cut = ready[:budget], ready[budget:]
            dropped = len(cut)
            eff_min = max(min_value, (keep[-1].get("value_usd") or min_value))
            log(f"{ch}: gas ${native_usd:,.2f} funds ~{budget} of {len(ready)} rows; "
                f"sweeping the top {len(keep)} (>= ${eff_min:,.2f}), deferring "
                f"{dropped} worth ${sum((r.get('value_usd') or 0) for r in cut):,.2f} "
                f"so the bridge stays fundable")
            ready = keep

        cmd = ["zerion", "consolidate", ch, tgt, "--wallet", wallet,
               "--include-stables", "--min-value", str(eff_min)]
        if excl:
            cmd += ["--exclude", ",".join(sorted(excl))]
        cmd.append("--execute")
        good = len(ready)
        log(f"{ch}: sweeping {good} rows -> {tgt} (excluding {len(excl)})")
        d = run(cmd)
        s = d.get("summary") or {}
        log(f"   {s.get('succeeded', '?')} ok, {s.get('failed', '?')} failed")


def bridge(chain, sym, amount, dest, wallet, label):
    """--cheapest ALWAYS executes. Bare `bridge` auto-executes on single-offer too,
    so there is no safe read-only probe; treat any bridge call as a commitment."""
    for attempt in (1, 2):
        d = run(["zerion", "bridge", chain, sym, amount, dest, "USDC",
                 "--wallet", wallet, "--timeout", "300", "--cheapest"])
        if d.get("error"):
            log(f"   {label} attempt {attempt}: ERROR {d['error'].get('code')}")
            time.sleep(8)
            continue
        tx = (d.get("tx") or {}).get("status")
        bd = d.get("bridgeDelivery") or {}
        log(f"   {label}: tx={tx} delivery={bd.get('status')} received={bd.get('received')}")
        if tx == "success":
            # delivery=timeout still usually lands; confirm later by checking the source drained
            return Decimal(str(bd.get("received") or 0))
        time.sleep(8)
    return None


def stage_b(wallet, addr, dest, min_value):
    log("\n===== STAGE B: bridge stablecoin/WETH balances home =====")
    got = Decimal(0)
    for p in norm(fetch(addr, key())):
        ch = p["chain"]
        if p["type"] != "wallet" or ch == dest or ch in NO_TRADE:
            continue
        want = target_for(ch)
        if p["symbol"] != want or p["value"] < 2:
            continue
        amt = format((Decimal(str(p["qty"])) * Decimal("0.999")).normalize(), "f")
        r = bridge(ch, want, amt, dest, wallet, f"{ch} {want} ${p['value']:.2f}")
        if r:
            got += r
    log(f"stage B delivered ~{got:.2f} USDC")


def stage_c(wallet, addr, dest, min_value):
    """Native -> destination USDC directly. THE step most easily forgotten:
    `consolidate` silently drops the native row unless --include-native is set.

    The floor is applied to what would actually be bridged (balance minus the
    reserve), not to the whole balance. A flat $5-on-the-balance test combined with
    a native-unit reserve used to bridge away nearly everything on cheap chains and
    leave a reserve worth cents -- passing the test while making the chain unusable.
    """
    log("\n===== STAGE C: bridge native gas tokens home =====")
    got = Decimal(0)
    for p in norm(fetch(addr, key())):
        ch = p["chain"]
        if p["type"] != "wallet" or not p["native"] or ch == dest or ch in NO_TRADE:
            continue
        price = p.get("price") or 0
        amt = Decimal(str(p["qty"])) - Decimal(reserve_for(ch, price))
        if amt <= 0:
            kept = reserve_usd(ch, price)
            log(f"   {ch} {p['symbol']} ${p['value']:.2f}: at or below reserve"
                f"{f' (~${kept:,.2f} kept)' if kept else ''}, skipped")
            continue
        # Below this, the bridge fee eats the transfer -- judge the amount actually
        # leaving, not the balance before the reserve is taken out.
        send_usd = float(amt) * price if price else p["value"]
        if send_usd < MIN_BRIDGE_USD:
            log(f"   {ch} {p['symbol']}: only ${send_usd:,.2f} above reserve "
                f"(< ${MIN_BRIDGE_USD:.2f} floor), leaving it as gas")
            continue
        r = bridge(ch, p["symbol"], format(amt.normalize(), "f"), dest, wallet,
                   f"{ch} {p['symbol']} ${p['value']:.2f}")
        if r:
            got += r
    log(f"stage C delivered ~{got:.2f} USDC")


def stage_d(wallet, dest, min_value):
    log(f"\n===== STAGE D: {dest} local sweep + native swap =====")
    plan = run(["zerion", "consolidate", dest, "USDC", "--wallet", wallet,
                "--include-stables", "--min-value", str(min_value)])
    excl = set()
    for r in plan.get("rows", []):
        if r.get("status") != "ready":
            continue
        v, o = r.get("value_usd") or 0, r.get("expected_output_usd") or 0
        if r["symbol"].upper() in DEFI_RECEIPTS or (v > 0 and o / v > MAX_GAIN):
            excl.add(r["symbol"])
    cmd = ["zerion", "consolidate", dest, "USDC", "--wallet", wallet,
           "--include-stables", "--min-value", str(min_value)]
    if excl:
        cmd += ["--exclude", ",".join(sorted(excl))]
    cmd.append("--execute")
    d = run(cmd)
    s = d.get("summary") or {}
    log(f"   sweep: {s.get('succeeded', '?')} ok, {s.get('failed', '?')} failed")

    # Native last, and never all of it.
    wl = run(["zerion", "wallet", "list"])
    addr = next((w["evmAddress"] for w in wl.get("wallets", []) if w["name"] == wallet), None)
    for p in norm(fetch(addr, key())):
        if p["chain"] == dest and p["native"] and p["type"] == "wallet":
            price = p.get("price") or 0
            keep = reserve_for(dest, price)
            amt = Decimal(str(p["qty"])) - Decimal(keep)
            if amt <= 0:
                kept = reserve_usd(dest, price)
                log(f"   native at or below reserve"
                    f"{f' (~${kept:,.2f} kept for gas)' if kept else ''}, nothing to swap")
                break
            log(f"   swapping {amt} {p['symbol']} -> USDC (reserve {keep} kept)")
            r = run(["zerion", "swap", dest, format(amt.normalize(), "f"),
                     p["symbol"], "USDC", "--wallet", wallet,
                     "--slippage", "0.5", "--timeout", "300"])
            log(f"   tx={(r.get('tx') or {}).get('status')} out={(r.get('swap') or {}).get('output')}")
            break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--dest", default="ethereum")
    ap.add_argument("--min-value", type=float, default=1.0)
    ap.add_argument("--stages", default="ABCD")
    ap.add_argument("--plan-only", action="store_true")
    a = ap.parse_args()

    wl = run(["zerion", "wallet", "list"])
    addr = next((w["evmAddress"] for w in wl.get("wallets", []) if w["name"] == a.wallet), None)
    if not addr:
        log(f"wallet '{a.wallet}' not in vault"); return 1

    chains = chains_with_value(addr, a.min_value, a.dest)
    log(f"wallet {a.wallet} = {addr}")
    log(f"{len(chains)} trade-capable chains with value >= ${a.min_value:g}")
    if a.plan_only:
        for c, ps in sorted(chains.items(), key=lambda kv: -sum(x['value'] for x in kv[1])):
            nat = sum(x["value"] for x in ps if x["native"])
            log(f"   {sum(x['value'] for x in ps):10,.2f} {c:22s} -> {target_for(c)}"
                f"   native ${nat:,.2f}")
        return 0

    if "A" in a.stages:
        stage_a(a.wallet, chains, a.dest, a.min_value)
    if "B" in a.stages:
        stage_b(a.wallet, addr, a.dest, a.min_value)
    if "C" in a.stages:
        stage_c(a.wallet, addr, a.dest, a.min_value)
    if "D" in a.stages:
        stage_d(a.wallet, a.dest, a.min_value)
    log("\nLIQUIDATEDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
