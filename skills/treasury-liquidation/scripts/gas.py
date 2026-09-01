"""Per-chain native-token reserves and gas affordability.

Two things have to be true of a reserve, and a single native-unit figure only
guarantees the first:

  1. It must not strand real value -- so it cannot be large.
  2. It must actually pay for a few more transactions -- so it cannot be worth
     cents.

Native-unit reserves alone fail (2) on cheap chains. A reserve of 1 POL or 1 XDAI
is worth roughly $0.20; once a sweep has bridged the rest of the balance away that
chain cannot broadcast anything, and whatever failed to sell there is stranded
until someone tops it up by hand. That is how value was lost in two real runs.

So the reserve is the LARGER of the per-chain native figure and whatever amount is
worth MIN_RESERVE_USD. Pass `price` (USD per native unit) to get that behaviour;
without it you get the bare native figure and the previous semantics.
"""
from decimal import Decimal

# Enough to cover several more transactions on that chain, not so much that real
# value is stranded. Sized from observed gas costs during real sweeps; the L2
# figures are deliberately generous because a chain left with zero gas becomes
# unusable and its remaining tokens unrecoverable without a manual top-up.
RESERVE = {
    # Ethereum mainnet: gas is expensive, keep the most.
    "ethereum": "0.005",
    # ETH-denominated L2s.
    "base": "0.0008", "arbitrum": "0.0008", "optimism": "0.0008", "scroll": "0.0008",
    "linea": "0.0008", "zora": "0.0008", "blast": "0.0008", "ink": "0.0008",
    "soneium": "0.0008", "unichain": "0.0008", "world": "0.0008", "katana": "0.0008",
    "megaeth": "0.0008", "zksync-era": "0.0015", "abstract": "0.0015",
    "robinhood": "0.0015",
    # Own-gas-token chains.
    "binance-smart-chain": "0.004", "avalanche": "0.03", "polygon": "1",
    "xdai": "1", "celo": "0.5", "mantle": "2", "ape": "2", "monad": "5",
    "hyperevm": "0.05", "sonic": "1", "berachain": "0.1", "plasma": "1",
    "lens": "0.3", "gravity-alpha": "1",
}
DEFAULT = "0.002"

# A reserve worth less than this cannot fund a retry, so the chain becomes a
# one-way trip. Cheap-gas chains need this floor; Ethereum's native figure
# already exceeds it.
MIN_RESERVE_USD = 2.50

# Rough per-transaction gas costs in USD, used to decide whether a chain can
# afford a planned batch. Deliberately conservative: overestimating leaves a
# little dust behind, underestimating strands a whole chain's proceeds.
#
# Calibrated against a real run: 44 consolidate swaps on `robinhood` consumed
# ~$12.00 of ETH, i.e. ~$0.27 each. An earlier $0.12 guess would have permitted
# 96 swaps and reproduced exactly the failure this cap exists to prevent, so the
# default is rounded UP from the observed figure rather than down.
SWAP_GAS_USD = {"ethereum": 3.00}
BRIDGE_GAS_USD = {"ethereum": 4.00}
DEFAULT_SWAP_GAS_USD = 0.30
DEFAULT_BRIDGE_GAS_USD = 0.40


def reserve_for(chain, price=None):
    """Native units to keep on `chain`.

    `price` is USD per native unit. When given, the reserve is raised so that it is
    worth at least MIN_RESERVE_USD -- otherwise cheap chains keep a reserve worth
    cents and end up unable to transact at all.
    """
    base = Decimal(RESERVE.get(chain, DEFAULT))
    if price:
        try:
            p = Decimal(str(price))
        except Exception:
            return str(base)
        if p > 0:
            needed = Decimal(str(MIN_RESERVE_USD)) / p
            if needed > base:
                return format(needed.normalize(), "f")
    return str(base)


def reserve_usd(chain, price=None):
    """What the reserve is worth, for logging and floor comparisons."""
    if not price:
        return None
    return float(Decimal(reserve_for(chain, price)) * Decimal(str(price)))


def swap_gas_usd(chain):
    return SWAP_GAS_USD.get(chain, DEFAULT_SWAP_GAS_USD)


def bridge_gas_usd(chain):
    return BRIDGE_GAS_USD.get(chain, DEFAULT_BRIDGE_GAS_USD)


def affordable_swaps(chain, native_usd):
    """How many swaps this chain's gas can fund while still leaving enough for the
    bridge that has to follow them.

    Sweeping a chain down to its last cent of gas is self-defeating: the proceeds
    then cannot be bridged out, so the sweep has only converted tokens into a
    different stranded token. Returns 0 when the chain cannot even fund a bridge.
    """
    budget = (native_usd or 0) - bridge_gas_usd(chain)
    if budget <= 0:
        return 0
    return int(budget // swap_gas_usd(chain))
