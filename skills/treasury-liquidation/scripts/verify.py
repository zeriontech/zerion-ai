#!/usr/bin/env python3
"""On-chain truth. Never report money as moved based on CLI output alone.

A hung `zerion swap` is indistinguishable from a pending one: the process stays
alive and prints nothing. Equal `latest` and `pending` nonces prove nothing was
ever broadcast.

Usage:
    verify.py --address 0x...                        # ETH + USDC on Ethereum, nonces
    verify.py --address 0x... --token 0xa0b8...      # any ERC-20
    verify.py --address 0x... --rpc https://...      # non-Ethereum chain
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netutil import rpc  # noqa: E402

# llamarpc 521s and cloudflare-eth returns internal errors; publicnode is reliable.
DEFAULT_RPC = "https://ethereum-rpc.publicnode.com"
USDC_ETHEREUM = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"




def erc20_balance(url, token, addr, decimals=6):
    data = "0x70a08231" + addr.lower().replace("0x", "").rjust(64, "0")
    return int(rpc(url, "eth_call", [{"to": token, "data": data}, "latest"]), 16) / 10 ** decimals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    ap.add_argument("--rpc", default=DEFAULT_RPC)
    ap.add_argument("--token", help="ERC-20 contract (default: USDC on Ethereum)")
    ap.add_argument("--decimals", type=int, default=6)
    a = ap.parse_args()

    native = int(rpc(a.rpc, "eth_getBalance", [a.address, "latest"]), 16) / 1e18
    print(f"native:  {native:.9f}")

    tok = a.token or USDC_ETHEREUM
    try:
        print(f"token:   {erc20_balance(a.rpc, tok, a.address, a.decimals):,.6f}  ({tok[:10]}...)")
    except Exception as e:
        print(f"token:   ERROR {e}")

    latest = int(rpc(a.rpc, "eth_getTransactionCount", [a.address, "latest"]), 16)
    pending = int(rpc(a.rpc, "eth_getTransactionCount", [a.address, "pending"]), 16)
    print(f"nonce:   latest={latest} pending={pending}"
          + ("  (equal -> nothing in flight)" if latest == pending
             else f"  ({pending - latest} tx in mempool)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
