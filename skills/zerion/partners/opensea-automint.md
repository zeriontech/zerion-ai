---
name: opensea-automint
description: >
  Mint OpenSea SeaDrop drops unattended — discover open drops, judge them on
  live market data, fund the minting wallet with Zerion CLI, wait for the mint
  window, and execute with safety rails. Use when the user wants to auto-mint
  or schedule an NFT mint, check drop eligibility or timing, or fund and verify
  a wallet ahead of a drop. Not for secondary-market buying, listing, or offers.
license: MIT
allowed-tools: Bash
---

# Zerion + OpenSea: Unattended NFT Minting

**Purpose:** Mint OpenSea SeaDrop drops unattended — discover open drops, judge them on live market data, wait for the mint window, and execute with safety rails — using Zerion CLI to fund the minting wallet, verify the funds landed on the right chain, and account for the result.

**Architecture:** Zerion CLI owns the money (funding, bridging, swapping, balance verification, PnL). The mint bot owns the drop (stage timing, calldata, simulation, rails). The split is forced, not stylistic: Zerion's chain-touching commands are `swap`, `bridge`, `send`, `consolidate`, `sign-message`, and `sign-typed-data`, and none accepts arbitrary `to`/`data`/`value`. A SeaDrop `mintPublic()` call is not one of those shapes, so the mint signs from a local keystore while Zerion does everything around it.

## Key Commands

**Zerion (funding + verification):**
- `zerion positions <wallet> --positions simple` — find spendable balances per chain
- `zerion bridge <from-chain> <token> <amount> <to-chain> <token>` — fund the mint chain
- `zerion swap <chain> <amount> <from> <to>` — same-chain top-up (no bridge needed)
- `zerion portfolio <wallet>` — confirm funds landed on the chain the drop is on
- `zerion history <wallet> --chain <chain>` — confirm the mint transaction
- `zerion pnl <wallet>` — post-mint accounting

**automint (drop layer)** — run from a checkout, invoked as `node bin/mint.js`.
There is no published npm package; do not `npx automint`, which would resolve
to whatever unrelated package holds that name:
- `discover` / `scan` — list and rank every open SeaDrop drop
- `analyze <slug|url>` — reasoned verdict on one drop before spending
- `simulate <slug> --minter <addr>` — dry-run the transaction, never sends
- `arm <slug> [--live]` — wait for the window, simulate, run rails, mint
- `run [--live]` — continuous unattended mode

## Requirements

- Zerion CLI: `npm install -g zerion-cli`, `export ZERION_API_KEY="zk_..."`
- automint, pinned to a reviewed revision — the package is unpublished and must
  be installed from source. Apply this repository's required 15-day dependency
  cooldown before adopting any revision:

  ```bash
  git clone https://github.com/penumbraaasol/automint && cd automint
  git checkout 5b3d105        # pin; review the diff before moving this forward
  npm install
  ```
- OpenSea API key in `.env` as `OPENSEA_API_KEY`
  (free: `curl -X POST https://api.opensea.io/api/v2/auth/keys`)
- A funded minting wallet. Keep it separate from a wallet holding real value —
  the bot signs locally, so whatever the wallet holds is what a bug can reach.

## Workflow

### 1. Find a drop and judge it

```bash
node bin/mint.js scan --limit 10
node bin/mint.js analyze <slug-or-opensea-url>
```

`analyze` returns a verdict with the evidence on each side. It refuses to fake
confidence: a collection with no trading history returns `UNKNOWABLE` rather
than a number.

### 2. Create the minting wallet and note its address

Keep it separate from the wallet holding real value. The bot signs locally, so
whatever this wallet holds is what a bug can reach.

```bash
node bin/mint.js keygen        # prompts for a password, prints the address
node bin/mint.js address       # print it again later
```

### 3. Check what you can fund it with

Funds do not travel between chains, and a drop can only be paid for in the
native token of its own chain.

```bash
zerion positions treasury --positions simple
```

### 4. Fund the MINT wallet — not the treasury

Both `swap` and `bridge` default to returning funds to the sending wallet, so
an explicit destination is required or the money lands back in the treasury and
the isolation is defeated.

Cross-chain — `bridge` takes a destination directly:

```bash
zerion bridge ethereum USDC 15 base ETH \
  --wallet treasury --to-address <MINT_ADDRESS> --cheapest
```

Same chain — `swap` has no destination flag, so swap then transfer:

```bash
zerion swap ethereum 20 USDC ETH --wallet treasury
zerion send ETH 0.01 --to <MINT_ADDRESS> --chain ethereum --wallet treasury
```

Then confirm the funds landed on the chain the drop is on, in the right wallet.
A transfer to the wrong chain looks identical to success:

```bash
zerion portfolio <MINT_ADDRESS>
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
MINT_KEYSTORE_PASSWORD=... \
node bin/mint.js arm <slug> --live --yes \
  --max-price 0.01 --max-gas-gwei 5 --cap 0.05
```

Two prerequisites for running this unattended, both of which fail silently
otherwise:

- **`--yes`** — without it the bot prompts for confirmation after the window
  opens, and with no TTY the prompt resolves to "no" and the mint is cancelled.
- **Keystore unlocking** — `MINT_KEYSTORE_PASSWORD` in the environment, since
  there is no TTY to type a password into. This puts the password in the
  process environment, so set the spending limits (`--max-price`,
  `--max-gas-gwei`, `--cap`) *before* enabling unattended execution.

It sleeps until the window, heartbeats while waiting, re-reads the contract in
case the creator moves the stage, simulates, runs every rail, then broadcasts.

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

- **Zerion cannot submit the mint itself.** No Zerion command accepts arbitrary
  calldata. Use Zerion for everything around the mint, not the mint.
- **A review threshold blocks unattended funding.** With
  `zerion wallet set-review-threshold <wallet> 0`, every transaction needs
  approval in the Zerion web app — correct for funding, fatal for anything
  meant to run unsupervised.
- **Funds do not travel.** A drop on Ethereum cannot be paid for with a balance
  on Base. Check per-chain balances before arming, not after.
- **`arm` is dry-run unless `--live`.** If nothing broadcast, look for the
  `DRY RUN` line before debugging anything else.
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
