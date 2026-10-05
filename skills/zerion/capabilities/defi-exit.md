# Zerion — Exit DeFi positions

Get out of protocol positions — withdraw, unstake, redeem, claim rewards, repay — and turn the
proceeds into whatever the user asked for. Most exits are two kinds of leg: a **protocol leg** that
no CLI command covers (you build it), then **conversion legs** that always go through `zerion swap`
/ `bridge` / `send`.

> First read the parent `SKILL.md` § "Rules for every on-chain task" — reading exact balances, the
> gas-vs-proceeds check, signing-link handling and scope all apply here. This file adds only what's
> specific to protocol positions.

## Setup

See the parent `SKILL.md` § "Setup — check before you do". An exit ends in a bundle handed to the
web app, which needs CLI 1.7.0 or newer.

## 1. Find the positions

```bash
zerion positions <address> --defi --chain <chain>   # grouped by protocol
```

**The user's request sets the scope; the CLI only confirms what's inside it.** This command returns
every DeFi position on the chain. Keep only the ones the user asked about (the protocol, positions
or chain they named) and leave the rest alone. They can come up in §5 as suggestions, never as exits.
Use the CLI to check that each requested position exists and what it holds. If one is missing, or
differs from what the user described, tell them rather than substituting something else.

For each position in scope, note the protocol, its type (deposit, staked, reward, LP, loan), the
chain, and the receipt token or contract it sits in.

## 2. Pick the way out

For each position, work out the correct exit:

- **Liquid receipt token** (an LP or vault share with a market) → often the simplest exit is just
  `zerion swap` on the receipt token. Compare it with withdrawing first.
- **Protocol call** — withdraw, unstake, redeem, claim, repay → build it yourself (§3–4).
- **Slow exit** — cooldown, unbonding period, epoch wait → before committing, quote selling the
  receipt token directly (`zerion swap <chain> <amount> <receipt> <target> --quote`) and compare it
  with the underlying value. Selling sometimes beats waiting; give the user both numbers.
- **Loans and leverage** → don't unwind as part of a list. Repaying or withdrawing collateral moves
  the health factor; raise it with the user on its own.
- **Expired or derelict** with no venue → say so and stop.

Then split the exit into legs: the protocol leg first, then each conversion. If you can't work out a
correct route for a position, say which one and why. Don't guess at calldata.

## 3. Research the protocol call

- **ABI and source** — Blockscout v2, keyless:
  `https://<chain>.blockscout.com/api/v2/smart-contracts/<address>`. For a proxy, follow it to the
  implementation.
- **Selectors and calldata** — compute them with viem, never from memory. `zerion-cli` ships viem:

  ```bash
  cd "$(npm root -g)/zerion-cli" && node -e "
    const { encodeFunctionData, parseAbi } = require('viem');
    console.log(encodeFunctionData({
      abi: parseAbi(['function withdraw(uint256 amount)']),
      functionName: 'withdraw',
      args: [1000n],
    }));"
  ```

  For a longer script, keep the file in your working directory and point Node at the CLI's
  packages: `NODE_PATH="$(npm root -g)/zerion-cli/node_modules" node script.js`. `require` resolves
  from the script's location, not the current directory, and inside the CLI's own folder a `.js`
  file can't use `require` at all, so don't write scripts there.

- **Prove it moves value** — `eth_call` the exact call from the user's address before building
  anything: the claimable amount is within what the reserves can pay, the redeemable balance is above
  zero. A revert means the call or its arguments are wrong.
- **Gas** — `eth_estimateGas` on the actual call. If a dry run reverts, use the gas limit you'll put
  in the envelope.

## 4. Build and send the protocol leg

Write it as a hand-built bundle group — `capabilities/bundle.md` § "Hand-built groups" has the
envelope and every field rule (`"route":"web-app"`, the six `evm` fields, slug vs. hex chain id).

A conversion can't be prepared from tokens the wallet doesn't hold yet. `zerion swap --prepare`
rejects an insufficient balance before it prints an envelope, and `bundle` checks outflows against
the wallet's current balances, not against what an earlier group in the bundle will bring in.
Pricing it is different: `zerion swap … --quote` works before the tokens arrive, so use it for the
gas-vs-proceeds check up front (its price leaves out network gas and the protocol fee until the
tokens are there). So:

- **By default, the protocol leg goes alone.** Send it, watch the chain over RPC until it confirms,
  then quote the swap and send its link right away. This holds even when you know the exact amount
  in advance, e.g. a fixed reward claim.
- **Same bundle only if the wallet already holds enough** of the token to cover the conversion
  before the protocol leg runs (check the raw on-chain balance). Then `zerion swap … --prepare` and
  add its group alongside the protocol leg so the user signs once.

## 5. After the exit

Once the last leg has confirmed:

- Read the rest of the portfolio, unscoped: `zerion positions <address>`. The scoped reads above say
  nothing about the rest of the wallet.
- Report by protocol: what it holds, roughly what it's worth, and whether it looks worth exiting
  after the gas-vs-proceeds check. Say briefly which you'd exit first and why — idle deposits earning
  nothing, a chain where gas is cheap right now, a protocol that looks abandoned. Flag loans and
  leveraged positions separately.
- Then **stop and wait**. The user asked about these positions, not the whole portfolio. Don't
  generate a link for another protocol until they pick one, and when they do, start again from §2.
- If nothing else is worth exiting, say exactly that in one line.

## Pair with

- `capabilities/analyze.md` — positions, portfolio and history reads.
- `capabilities/trading.md` — the swap, bridge and send legs.
- `capabilities/bundle.md` — signing several legs in one session, and hand-built groups.
