#!/usr/bin/env python3
"""PHASE 1 -- send every token above a floor from one wallet to another, all chains.

Raw transfers only: no swaps, so asset identity (and its cost basis) is preserved.
Use this when the sale should happen in the destination wallet, not the source.

Ordering is load-bearing: on each chain the native token pays for gas, so it is
sent LAST. Sending it first strands every remaining ERC-20 on that chain.

Usage:
    drain.py --from <source-wallet> --to 0x<destination-address> [--min-value 1] [--dry-run]

Run detached (nohup) -- a full drain is hundreds of sequential confirmations and
must not sit inside a tool-call timeout.
"""
import argparse, json, os, subprocess, sys, time
from collections import defaultdict
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inventory import fetch, norm, key  # noqa: E402
from gas import reserve_for  # noqa: E402


def run(args, timeout=600):
    env = dict(os.environ, ZERION_API_KEY=key())
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        out = p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        return {"error": {"code": "local_timeout"}}
    i = out.find("{")
    if i < 0:
        return {"error": {"code": "no_json", "message": out[:160]}}
    try:
        return json.JSONDecoder().raw_decode(out[i:])[0]
    except Exception:
        return {"error": {"code": "unparseable", "message": out[:160]}}


def build(rows, min_value):
    """Return (sends, skipped). sends are ordered ERC-20s-then-native, per chain."""
    by = defaultdict(list)
    for p in rows:
        if p["type"] == "wallet" and p["value"] >= min_value:
            by[p["chain"]].append(p)

    sends, skipped = [], []
    for ch, items in sorted(by.items(), key=lambda kv: -sum(x["value"] for x in kv[1])):
        seen = defaultdict(int)
        for p in items:
            seen[p["symbol"]] += 1
        erc = [p for p in items if not p["native"]]
        nat = [p for p in items if p["native"]]
        for p in erc + nat:                      # native LAST: it pays the gas
            sym = p["symbol"]
            if not sym or not sym.strip() or sym == "?":
                skipped.append((p, "blank symbol"))   # `zerion send ""` -> missing_args
                continue
            if seen[sym] > 1:
                # `send` resolves BY SYMBOL; duplicates hit the wrong contract ("have 0")
                skipped.append((p, f"symbol x{seen[sym]} on {ch}"))
                continue
            q = Decimal(str(p["qty"]))
            if p["native"]:
                # Price-aware: a native-unit reserve is worth cents on cheap chains,
                # leaving the source wallet unable to broadcast a retry.
                amt = q - Decimal(reserve_for(ch, p.get("price")))
                if amt <= 0:
                    skipped.append((p, "below gas reserve"))
                    continue
            else:
                amt = q * Decimal("0.999")   # indexer rounds UP past real wei
            if amt <= 0:
                continue
            sends.append((ch, sym, format(amt.normalize(), "f"), p["value"], p["native"]))
    return sends, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True, help="source wallet name")
    ap.add_argument("--to", required=True, help="destination 0x address")
    ap.add_argument("--min-value", type=float, default=1.0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    wl = run(["zerion", "wallet", "list"])
    addr = next((w["evmAddress"] for w in wl.get("wallets", []) if w["name"] == a.src), None)
    if not addr:
        print(f"source wallet '{a.src}' not in vault"); return 1

    sends, skipped = build(norm(fetch(addr, key())), a.min_value)
    print(f"PLAN: {len(sends)} sends, ${sum(s[3] for s in sends):,.2f}")
    print(f"SKIP: {len(skipped)} rows, ${sum(p['value'] for p, _ in skipped):,.2f}")
    for p, why in sorted(skipped, key=lambda x: -x[0]["value"])[:10]:
        print(f"   {p['value']:8.2f} {p['symbol']:12s} {p['chain']:16s} {why}")
    if a.dry_run:
        for ch, sym, amt, v, nat in sends[:40]:
            print(f"   {v:9.2f} {sym:12s} {ch:16s} {amt}{'  [native, last]' if nat else ''}")
        return 0

    ok, fail = 0, defaultdict(list)
    for i, (ch, sym, amt, v, nat) in enumerate(sends, 1):
        print(f"[{i}/{len(sends)}] {ch} {sym} ${v:.2f}", flush=True)
        d = run(["zerion", "send", sym, amt, "--to", a.to, "--chain", ch, "--wallet", a.src])
        if d.get("error"):
            code = d["error"].get("code", "?")
            fail[code].append((ch, sym, v))
            print(f"    FAIL {code}: {str(d['error'].get('message'))[:90]}", flush=True)
        elif (d.get("tx") or {}).get("status") == "success":
            ok += 1
            print(f"    ok {d['tx']['hash'][:14]}", flush=True)
        else:
            fail[str((d.get("tx") or {}).get("status"))].append((ch, sym, v))
            print(f"    FAIL tx={(d.get('tx') or {}).get('status')}", flush=True)

    print(f"\n=== DRAIN: {ok}/{len(sends)} ok ===")
    for code, rows in sorted(fail.items(), key=lambda x: -len(x[1])):
        print(f"  {len(rows):4d}  {code}  (${sum(r[2] for r in rows):,.2f})")
    print("DRAINDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
