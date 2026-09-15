---
name: opensea-automint
description: >
  Discover OpenSea SeaDrop drops worth minting, judge them on live market data,
  and schedule execution for the moment a mint window opens — with Zerion
  performing the mint. Use when the user wants to find or evaluate an NFT drop,
  check eligibility or timing, schedule a mint, or fund a wallet ahead of a
  drop. Not for secondary-market buying, listing, or offers.
license: MIT
allowed-tools: Bash
---

# Zerion + OpenSea: NFT Drop Discovery

**Purpose:** Find OpenSea SeaDrop drops worth minting, judge them on live market
data, and schedule execution for the moment a mint window opens — with Zerion
performing the mint itself.

**Architecture:** automint is a **discovery and scheduling layer only**. It
decides *what* to mint and *when*; Zerion decides whether that is allowed and
signs it. automint holds no private keys and cannot sign a transaction, so
agent tokens, policies, review thresholds and spend limits are enforced in one
place rather than reimplemented by a third-party tool.

Execution is delegated to a native `zerion mint` primitive. automint passes the
**drop** — chain, collection, quantity — rather than prebuilt calldata:
forwarding bytes Zerion did not construct would leave its policies applying to
an opaque blob instead of real intent.

> **Status:** the mint primitive is in progress on the Zerion side. Until it
> ships, automint prepares and validates the mint, then reports the intent
> instead of executing. Discovery, scoring and scheduling are usable today.

## Key Commands

**Zerion (execution + money):**
- `zerion mint <chain> <contract> [--quantity N]` — perform the mint *(in progress)*
- `zerion wallet list` — the wallet automint will target, and its policies
- `zerion positions <wallet>` — spendable balance per chain
- `zerion bridge` / `zerion swap` — fund the chain the drop is on
- `zerion portfolio <wallet>` — confirm funds landed on the right chain
- `zerion history <wallet> --chain <chain>` — confirm the mint transaction
- `zerion pnl <wallet>` — post-mint accounting

**automint (discovery + scheduling)** — run from a checkout as `node bin/mint.js`:
- `discover` / `scan` — list and rank every open SeaDrop drop
- `analyze <slug|url>` — reasoned verdict on one drop before spending
- `simulate <slug> --minter <addr>` — dry-run the transaction, never sends
- `arm <slug> [--live]` — wait for the window, simulate, then delegate to Zerion
- `run [--live]` — continuous discovery, delegating each mint

## Requirements

- Zerion CLI: `npm install -g zerion-cli`, `export ZERION_API_KEY="zk_..."`
- automint, pinned to a reviewed revision — the package is unpublished and must
  be installed from source. Apply this repository's required 15-day dependency
  cooldown before adopting any revision:

  ```bash
  git clone https://github.com/penumbraaasol/automint && cd automint
  git checkout 2102e11        # pin; review the diff before moving this forward
  npm install
  ```
- OpenSea API key in `.env` as `OPENSEA_API_KEY`
  (free: `curl -X POST https://api.opensea.io/api/v2/auth/keys`)
- A Zerion wallet with funds on the chain the drop is on. automint targets the
  wallet Zerion reports and never handles its key.

## Workflow

### 1. Find a drop and judge it

```bash
node bin/mint.js scan --limit 10
node bin/mint.js analyze <slug-or-opensea-url>
```

`analyze` returns a verdict with the evidence on each side. It refuses to fake
confidence: a collection with no trading history returns `UNKNOWABLE` rather
than a number.

### 2. Identify the wallet Zerion will mint from

automint targets a Zerion wallet and never handles its key. Check which one,
and what policy governs it:

```bash
zerion wallet list
```

### 3. Check it can pay on the drop's chain

Funds do not travel between chains, and a drop can only be paid for in the
native token of its own chain.

```bash
zerion positions <wallet> --positions simple
```

### 4. Fund that chain if needed

Cross-chain:

```bash
zerion bridge ethereum USDC 15 base ETH --wallet <wallet> --cheapest
```

Same chain, wrong asset:

```bash
zerion swap ethereum 20 USDC ETH --wallet <wallet>
```

Then confirm the funds landed on the chain the drop is on — a transfer to the
wrong chain looks identical to success:

```bash
zerion portfolio <wallet>
```

### 5. Dry run against the funded wallet

```bash
node bin/mint.js arm <slug> --max-price 0.01 --max-gas-gwei 5
```

`arm` is dry-run by default. Run it once funded, before going live — the
"rails all passed" path behaves differently from the unfunded path and should
not execute for the first time during a real drop.

### 6. Mint

```bash
node bin/mint.js arm <slug> --live --max-price 0.01 --cap 0.05
```

automint sleeps until the window, heartbeats while waiting, re-reads the
contract in case the creator moves the stage, simulates, checks its own
pre-flight limits — then calls `zerion mint`, which applies the wallet's
policies and signs.

Because signing happens inside Zerion, a wallet with a review threshold will
park the transaction for approval in the web app. That is correct for
supervised use and fatal for unattended use; see Common Blockers.

### 7. Confirm and account for it

```bash
zerion history <mint-wallet> --chain <chain> --limit 5
zerion pnl <mint-wallet>
```

## What the mint bot checks

Every rail runs after the window opens and immediately before signing, because
price, gas and supply all move between arming and firing.

| Rail | Flag |
|---|---|
| Unit price ceiling | `--max-price <eth>` |
| Gas price ceiling | `--max-gas-gwei <n>` |
| Lifetime spend cap | `--cap <eth>` |
| Balance, chainId, per-wallet cap, no-double-mint | always on |

Simulation is the one that matters most: an `eth_call` against the exact
calldata catches not-started, sold-out, wrong-price and not-eligible before any
gas is spent.

## Common Blockers

- **`zerion mint` is not shipped yet.** Until it is, `arm --live` validates the
  mint and reports the intent rather than executing. Discovery and scoring work
  today.
- **A review threshold blocks unattended minting.** With
  `zerion wallet set-review-threshold <wallet> 0`, every transaction waits for
  approval in the Zerion web app. Correct when supervised; no unattended caller
  can satisfy it, and a scheduled mint will miss its window waiting.
- **Funds do not travel.** A drop on Ethereum cannot be paid for with a balance
  on Base. Check per-chain balances before arming, not after.
- **`arm` is dry-run unless `--live`.** If nothing broadcast, look for the
  `DRY RUN` line before debugging anything else.
- **automint cannot sign.** It holds no keys by design. If a mint did not
  happen, the cause is in Zerion's execution path or its policies, not in a
  local keystore.
- **The advertised floor is a listing, not a trade.** On thin collections one
  optimistic listing produces an absurd floor. Judge on the realized clearing
  price and on live collection offers. Note that a collection offer is
  *pre-authorised*, not escrowed: OpenSea reserves the bidder's WETH and funds
  move only on acceptance, so an offer can become unfunded or be cancelled.
  Treat it as the best available exit signal, not a guaranteed exit.
- **A sold-out drop still reports `MINTING`** in OpenSea's feeds. The only other
  symptom is a `MintQuantityExceedsMaxSupply` revert at simulation time.
- **The bot will not win contested mints.** Start times are published, so the
  race is pure propagation latency, lost to Flashbots-bundle operators. Its
  edge is never missing a window, not speed.

## Related Skills

- **capabilities/analyze.md** — portfolio, positions, PnL for verifying funding
- **capabilities/trading.md** — swap/bridge/send mechanics used to fund the mint
- **capabilities/wallet.md** — wallet creation, funding addresses, backup
- **capabilities/agent-management.md** — agent tokens and policies for
  guardrails on the funding wallet
