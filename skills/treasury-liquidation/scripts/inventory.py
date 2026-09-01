#!/usr/bin/env python3
"""Accurate multi-chain inventory. Separates real wallet tokens from DeFi noise.

Why not just `zerion positions`: that view re-lists DeFi *underlyings* (an Aave
deposit's LINK, an Index Coop basket's ENA) as if they were wallet tokens. Sweeping
them makes `consolidate` try to sell tokens the wallet doesn't hold, and the swaps
revert on-chain -- burning gas. The raw API carries `position_type`, so wallet vs
DeFi is unambiguous.

Also flags broken price feeds: a single bad row (a token quoted thousands of times
its real value) can inflate the reported total beyond recognition.

Usage:
    inventory.py --address 0x... [--min-value 1] [--json out.json]
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netutil import get_json  # noqa: E402
from collections import defaultdict

API = "https://api.zerion.io/v1"
# Chains Zerion indexes but cannot trade or bridge -- value here is unreachable.
NO_TRADE = {"aurora", "polygon-zkevm", "okbchain", "degen", "somnia"}
# Trade-capable chains with no USDC implementation: sweep to WETH, then bridge.
NO_USDC = {"robinhood", "blast", "megaeth"}


def key():
    k = os.environ.get("ZERION_API_KEY")
    if k:
        return k
    p = os.path.expanduser("~/.zerion/config.json")
    if os.path.exists(p):
        return json.load(open(p)).get("apiKey")
    return None


def fetch(addr, k):
    """Page through positions. Returns raw JSON:API rows."""
    rows, url = [], f"{API}/wallets/{addr}/positions?page%5Bsize%5D=100"
    while url:
        d = get_json(url, api_key=k)
        rows += d.get("data", [])
        url = (d.get("links") or {}).get("next")
    return rows


def norm(rows):
    out = []
    for p in rows:
        a = p["attributes"]
        fi = a.get("fungible_info") or {}
        ch = ((p.get("relationships") or {}).get("chain") or {}).get("data", {}).get("id")
        impls = [i for i in fi.get("implementations", []) if i.get("chain_id") == ch]
        out.append({
            "chain": ch,
            "symbol": (fi.get("symbol") or "?"),
            "name": fi.get("name") or "",
            "type": a.get("position_type") or "?",
            "value": float(a.get("value") or 0),
            "qty": float((a.get("quantity") or {}).get("float") or 0),
            "price": float(a.get("price") or 0),
            "address": impls[0].get("address") if impls else None,
            "native": bool(impls) and impls[0].get("address") is None,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    ap.add_argument("--min-value", type=float, default=1.0)
    ap.add_argument("--json")
    a = ap.parse_args()

    k = key()
    if not k:
        print("no API key; set ZERION_API_KEY", file=sys.stderr)
        return 1
    pos = norm(fetch(a.address, k))

    wallet = [p for p in pos if p["type"] == "wallet"]
    defi = [p for p in pos if p["type"] != "wallet"]

    # Price-feed sanity: a token worth >25% of the book on its own is usually a bad feed.
    total = sum(p["value"] for p in wallet)
    suspect = [p for p in wallet if total and p["value"] / total > 0.25 and p["value"] > 10000]

    live = [p for p in wallet if p["value"] >= a.min_value and p not in suspect]
    print(f"WALLET positions >= ${a.min_value:g}: {len(live)}  "
          f"${sum(p['value'] for p in live):,.2f}")
    print(f"DeFi positions: {len(defi)}  ${sum(p['value'] for p in defi):,.2f} "
          f"(NOT sweepable -- receipt tokens have no swap route)")
    if suspect:
        print("\n!! SUSPECT PRICE FEEDS (excluded from totals -- verify before trusting):")
        for p in suspect:
            print(f"   {p['symbol']:10s} {p['chain']:12s} qty={p['qty']:.6f} "
                  f"@ ${p['price']:,.2f} = ${p['value']:,.2f}")

    by = defaultdict(list)
    for p in live:
        by[p["chain"]].append(p)

    print(f"\n{'chain':22s} {'total':>10s} {'n':>4s}  {'route':16s} {'native':>9s}")
    reach = unreach = 0.0
    for ch, ps in sorted(by.items(), key=lambda kv: -sum(x["value"] for x in kv[1])):
        t = sum(x["value"] for x in ps)
        nat = sum(x["value"] for x in ps if x["native"])
        if ch in NO_TRADE:
            route, unreach = "UNREACHABLE", unreach + t
        else:
            route = "-> WETH" if ch in NO_USDC else "-> USDC"
            reach += t
        print(f"{ch:22s} {t:10,.2f} {len(ps):4d}  {route:16s} {nat:9,.2f}")

    print(f"\nreachable   ${reach:,.2f}")
    print(f"unreachable ${unreach:,.2f}  (no trading or bridging on Zerion)")
    print(f"defi        ${sum(p['value'] for p in defi):,.2f}  (needs protocol withdrawal)")

    if a.json:
        json.dump({"wallet": live, "defi": defi, "suspect": suspect},
                  open(a.json, "w"), indent=2)
        print(f"\nwrote {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
