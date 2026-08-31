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

**automint (drop layer)** — `npx automint` or `node bin/mint.js`:
- `discover` / `scan` — list and rank every open SeaDrop drop
- `analyze <slug|url>` — reasoned verdict on one drop before spending
- `simulate <slug> --minter <addr>` — dry-run the transaction, never sends
- `arm <slug> [--live]` — wait for the window, simulate, run rails, mint
- `run [--live]` — continuous unattended mode

## Requirements

- Zerion CLI: `npm install -g zerion-cli`, `export ZERION_API_KEY="zk_..."`
- automint: <https://github.com/penumbraaasol/automint>, `npm install`
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

### 2. Check what you can fund it with

Funds do not travel between chains, and a drop can only be paid for in the
native token of its own chain.

```bash
zerion positions treasury --positions simple
```

### 3. Fund the mint chain

Same chain, wrong asset — a swap:

```bash
zerion swap ethereum 20 USDC ETH --wallet treasury
```

Wrong chain — a bridge (does bridge + swap in one):

```bash
zerion bridge ethereum USDC 15 base ETH --wallet treasury --cheapest
```

Then confirm it actually landed on the chain the drop is on. A bridge that
succeeded to the wrong chain looks identical to success:

```bash
zerion portfolio <mint-wallet>
```

### 4. Dry run against the funded wallet

```bash
node bin/mint.js arm <slug> --max-price 0.01 --max-gas-gwei 5
```

`arm` is dry-run by default. Run it once funded, before going live — the
"rails all passed" path behaves differently from the unfunded path and should
not execute for the first time during a real drop.

### 5. Mint

```bash
node bin/mint.js arm <slug> --live --max-price 0.01 --max-gas-gwei 5 --cap 0.05
```

It sleeps until the window, heartbeats while waiting, re-reads the contract in
case the creator moves the stage, simulates, runs every rail, then broadcasts.

### 6. Confirm and account for it

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
  price and on live collection offers — a bid is escrowed, a listing is free to
  post.
- **A sold-out drop still reports `MINTING`** in OpenSea's feeds. The only other
  symptom is a `MintQuantityExceedsMaxSupply` revert at simulation time.
- **The bot will not win contested mints.** Start times are published, so the
  race is pure propagation latency, lost to Flashbots-bundle operators. Its
  edge is never missing a window, not speed.

## Related Skills

- **capabilities/analyze.md** — portfolio, positions, PnL for verifying funding
- **capabilities/trading.md** — swap/bridge/send mechanics used to fund the mint
- **capabilities/wallet.md** — wallet creation, funding addresses, backup
- **capabilities/agent.md** — agent tokens and policies for guardrails on the
  funding wallet
