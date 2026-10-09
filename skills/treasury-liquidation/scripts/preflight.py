#!/usr/bin/env python3
"""Verify auth before any liquidation run. Fails fast with actionable fixes.

An invalid/revoked ZERION_API_KEY makes every CLI command HANG FOREVER with no
error, so this checks the key over raw HTTP (fast, unambiguous) before trusting
the CLI at all.

Usage:
    preflight.py --wallet "<wallet-name>"
    preflight.py --wallet "<wallet-name>" --key zk_...
"""
import argparse, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netutil import head_status  # noqa: E402

API = "https://api.zerion.io/v1"


def resolve_key(explicit=None):
    """Key precedence mirrors the CLI: env wins over config.json."""
    sources = []
    if explicit:
        sources.append(("--key", explicit))
    env = os.environ.get("ZERION_API_KEY")
    if env:
        sources.append(("env ZERION_API_KEY", env))
    cfg_path = os.path.expanduser("~/.zerion/config.json")
    cfg = {}
    if os.path.exists(cfg_path):
        try:
            cfg = json.load(open(cfg_path))
        except Exception:
            pass
    if cfg.get("apiKey"):
        sources.append(("config.json", cfg["apiKey"]))
    return sources, cfg


def check_key(key, timeout=15):
    """Return (ok, detail). Raw HTTP so a bad key errors instead of hanging."""
    code = head_status(f"{API}/chains", api_key=key, timeout=timeout)
    return code == 200, f"HTTP {code}" if code else "no response"


def cli(args, key, timeout=60):
    env = dict(os.environ, ZERION_API_KEY=key)
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        out = p.stdout + p.stderr
        i = out.find("{")
        return json.JSONDecoder().raw_decode(out[i:])[0] if i >= 0 else None
    except subprocess.TimeoutExpired:
        return {"error": {"code": "cli_hang"}}
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--key")
    a = ap.parse_args()

    sources, _ = resolve_key(a.key)
    if not sources:
        print("FAIL: no API key found (--key, $ZERION_API_KEY, or ~/.zerion/config.json)")
        return 1

    print("API key sources, in the CLI's precedence order:")
    good = None
    for name, k in sources:
        ok, detail = check_key(k)
        print(f"  {'OK  ' if ok else 'BAD '} {name:22s} {k[:11]}...{k[-4:]}  {detail}")
        if ok and good is None:
            good = k

    winner = sources[0]
    if not check_key(winner[1])[0]:
        print(f"\nFAIL: the winning source ({winner[0]}) holds an INVALID key.")
        print("  The CLI will HANG SILENTLY on every command, including reads.")
        if good:
            print(f"  A valid key exists in another source. Prefix commands:")
            print(f"    ZERION_API_KEY={good} zerion ...")
            print("  Shell env does not persist between agent tool calls -- prefix EVERY call.")
        else:
            print("  No valid key in any source. Get one at dashboard.zerion.io.")
        return 1
    key = winner[1]
    print(f"\nUsing {winner[0]}.")

    # Wallet must exist locally (keys required to sign).
    wl = cli(["zerion", "wallet", "list"], key)
    if not wl:
        print("FAIL: `zerion wallet list` returned nothing.")
        return 1
    names = {w["name"]: w for w in wl.get("wallets", [])}
    if a.wallet not in names:
        print(f"FAIL: wallet '{a.wallet}' not in local vault. Available: {sorted(names)}")
        print("  Without the private key nothing can be signed. Import it first.")
        return 1
    print(f"Wallet '{a.wallet}' = {names[a.wallet]['evmAddress']}")

    # An expired policy blocks every write with `policy denied`, before broadcast.
    toks = cli(["zerion", "agent", "list-tokens"], key) or {}
    active = [t for t in toks.get("tokens", [])
              if t.get("wallet") == a.wallet and t.get("active")]
    if not active:
        print(f"\nFAIL: no ACTIVE agent token for '{a.wallet}'. Writes will fail.")
        print_token_fix(a.wallet)
        return 1

    pols = cli(["zerion", "agent", "list-policies"], key) or {}
    exp = {p["name"]: r["timestamp"]
           for p in pols.get("policies", [])
           for r in p.get("rules", []) if r["type"] == "expires_at"}
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    live = False
    for t in active:
        for p in t.get("policies", []):
            ts = exp.get(p["name"])
            if not ts:
                continue
            when = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            left = when - now
            state = "EXPIRED" if left.total_seconds() <= 0 else f"{left.days}d {left.seconds//3600}h left"
            print(f"  token {t['name']} -> policy {p['name']}: {state}")
            if left.total_seconds() > 0:
                live = True
    if not live:
        print(f"\nFAIL: every policy on '{a.wallet}' has expired.")
        print_token_fix(a.wallet)
        return 1

    print("\nPreflight OK. Writes should succeed.")
    return 0


def print_token_fix(wallet):
    print("  Fix (create-policy is agent-runnable; create-token is NOT):")
    print("    zerion agent create-policy --name liq-3d --expires 3d")
    print(f'    zerion agent create-token --name liq --wallet "{wallet}" --policy <policy-id>')
    print("  create-token needs a REAL TTY. The agent cannot run it, and neither can")
    print("  Claude Code's `!` prefix -- both fail 'Passphrase must be entered in an")
    print("  interactive terminal'. The user must run it in their own terminal window.")


if __name__ == "__main__":
    sys.exit(main())
