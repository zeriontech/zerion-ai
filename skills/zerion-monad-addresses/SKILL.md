---
name: zerion-monad-addresses
description: >
  Canonical Monad mainnet smart contract addresses for use with Zerion CLI: bridged
  stablecoins (USDC, USDT0, USD1, AUSD), wrapped MON, signing canonicals (Permit2,
  ERC-4337, ERC-6492), wallet primitives (Multicall3, Safe), ERC-8004 trustless-agent
  registries, and DEX / aggregator / cross-chain router addresses for `zerion agent
  create-policy --allowlist` lockdown. Points at the official monad-crypto/token-list
  and monad-crypto/protocols repos as authoritative fallbacks, with a one-line
  `cast code` verification recipe before any address is used.
license: MIT
---

# Monad Addresses

**Purpose:** Provide a canonical, verified-on-the-spot reference for Monad mainnet contract addresses so an agent can pass explicit `0x…` token addresses to `zerion swap` / `bridge` / `send` (the documented "prefer the explicit address when the symbol is ambiguous" path) and to `zerion sign-typed-data` for Permit2 flows.

**Monad chain ID:** `143`
**Monad chain name (Zerion CLI):** `monad`

> ⚠️ Always verify the address on a Monad explorer (`monadscan.com`) before sending value. A wrong address loses funds. The verification recipe below is one bash line.

## Key Commands

- `zerion swap monad <amount> <0x-from> <0x-to>` — same-chain swap on Monad with explicit token addresses
- `zerion bridge <chain> <token> <amount> monad <0x-to>` — bridge into Monad targeting a token by address
- `zerion send <0x-token-or-symbol> <amount> --to <0x...> --chain monad` — ERC-20 transfer on Monad
- `zerion sign-typed-data --file permit.json --chain monad` — sign a Permit2 EIP-712 message against the canonical Permit2 deployment
- `cast code <addr> --rpc-url https://rpc.monad.xyz` — verify a contract has bytecode on Monad mainnet (Foundry)

## Requirements

- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."` (analysis + trading need this; pay-per-call does not apply on Monad swaps)
- Optional: [Foundry](https://www.getfoundry.sh/introduction/installation) for the `cast code` verification recipe

## Workflow

### 1. Pick the address from the curated tables below

Tables are organized by what Zerion CLI users actually pass as token arguments — bridged stablecoins, wrapped native, and signing-protocol contracts. The full canonical-contracts list lives in [Monad's official network info](https://docs.monad.xyz/developer-essentials/network-information).

### 2. Verify the address has bytecode on the network you intend to use

```bash
# Mainnet
cast code 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 --rpc-url https://rpc.monad.xyz

# Or without Foundry — JSON-RPC eth_getCode:
curl -s https://rpc.monad.xyz \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x754704Bc059F8C67012fEd69BC8A327a5aafb603","latest"],"id":1}'
```

A non-empty `0x…` response confirms code is deployed. `0x` (empty) means the address is an EOA or has no code on that network — do not use it.

### 3. Use with Zerion CLI

```bash
# Swap USDC → MON on Monad using the explicit USDC address
zerion swap monad 5 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 MON

# Bridge USDC from Base into USDT0 on Monad
zerion bridge base USDC 5 monad 0xe7cd86e13AC4309349F30B3435a9d337750fC82D

# Send WMON to a recipient
zerion send 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A 0.5 \
  --to 0x... --chain monad
```

## Token not listed below? Check the official token list

If the token an agent needs is not in the curated tables below, look it up in the official Monad token list — a Uniswap-style `tokens[]` array maintained at <https://github.com/monad-crypto/token-list>.

```bash
# Mainnet — find a token by symbol or name
curl -s https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist-mainnet.json \
  | jq '.tokens[] | select(.symbol == "WETH")'

# Testnet
curl -s https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist-testnet.json \
  | jq '.tokens[] | select(.symbol == "USDC")'
```

Each entry has `{ symbol, name, address, decimals, chainId, logoURI }`. Pull `address` and pass it to `zerion swap` / `bridge` / `send`. Still verify with `cast code` (above) before sending value.

## Bridged stablecoins on Monad mainnet

| Symbol | Name | Address |
|--------|------|---------|
| USDC | USD Coin | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| USDT0 | Tether USD | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` |
| USD1 | USD1 | `0x111111d2bf19e43C34263401e0CAd979eD1cdb61` |
| AUSD | Agora USD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |

## Wrapped native

| Symbol | Name | Address |
|--------|------|---------|
| WMON | Wrapped MON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |

Native MON has no contract address — pass `MON` as a symbol to `zerion swap` / `send`. Use WMON when an ERC-20 representation is required (LP positions, contracts that don't accept value).

## Signing-protocol canonicals (relevant to `zerion-sign`)

| Contract | Address |
|----------|---------|
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |
| ERC-4337 EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| ERC-6492 UniversalSigValidator | `0xdAcD51A54883eb67D95FAEb2BBfdC4a9a6BD2a3B` |

When building an EIP-712 typed-data payload that targets Permit2 on Monad, the `domain.verifyingContract` is `0x000000000022d473030f116ddee9f6b43ac78ba3` and `domain.chainId` is `143`. Pipe the JSON to `zerion sign-typed-data --chain monad`.

## Wallet & batch primitives

| Contract | Address |
|----------|---------|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Safe (singleton) | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` |
| SafeL2 (singleton) | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` |
| MultiSendCallOnly | `0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B` |

Use Safe + Zerion agent tokens together when a Monad bot wallet needs both multi-party authorization (Safe owners) and per-call policy enforcement (Zerion `agent create-policy --chains monad …`).

## Protocol routers (for `--allowlist` policies)

These are the swap/aggregation entry points an agent transaction actually touches. Pair them with `zerion agent create-policy --allowlist <addr>` to lock a Monad agent token to specific protocols, so the bot can only route through DEXes you trust.

```bash
# Example — Kuru-only swap bot on Monad
zerion agent create-policy --name kuru-only \
  --chains monad \
  --allowlist 0xd651346d7c789536ebf06dc72ae3c8502cd695cc \
  --deny-transfers
```

Sourced from <https://github.com/monad-crypto/protocols> (`protocols-mainnet.csv`). The full per-protocol JSON files live under `mainnet/<protocol>.json` in the same repo. **These are community-maintained — verify with `cast code` before relying on any single address.**

### DEX Aggregators

| Protocol | Contract | Address |
|----------|----------|---------|
| Kuru | Router | `0xd651346d7c789536ebf06dc72ae3c8502cd695cc` |
| Monorail | AggregationRouter | `0xa68a7f0601effdc65c64d9c47ca1b18d96b4352c` |
| KyberSwap | MetaAggregationRouterV2 | `0x6131b5fae19ea4f9d964eac0408e4408b66337b5` |
| Mace | MaceRouter | `0x6f05a0746a8cb5c7de5af1568c8d020dbb521b23` |
| Fly Trade (Magpie) | MagpieRouterV3_1 | `0x956df8424b556f0076e8abf5481605f5a791cc7f` |
| Madhouse | Aggregator | `0x6017684bea9cb6e9874fc6dba4438271ebf9f5da` |
| OKX Wallet | Router | `0xb1e4e25b1938c78ec0b21ccb2d6a0be60aa7e63f` |
| Gmgn | Router | `0xc9ca80b5ea956afa98627963d1880033545d108e` |

### DEXes

| Protocol | Contract | Address |
|----------|----------|---------|
| Uniswap | UniversalRouter | `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` |
| PancakeSwap | SmartRouter | `0x21114915ac6d5a2e156931e20b20b038ded0be7c` |
| Curve | Router | `0xff5cb29241f002ffed2eaa224e3e996d24a6e8d1` |
| Balancer | Router | `0x9da18982a33fd0c7051b19f0d7c76f2d5e7e017c` |
| LFJ (Trader Joe) | LBRouter | `0x18556da13313f3532c54711497a8fedac273220e` |
| WooFi | WooRouterV2 | `0x4c4af8dbc524681930a27b2f1af5bcc8062e6fb7` |
| Clober | Router | `0x7b58a24c5628881a141d630f101db433d419b372` |
| Dexalot | DexalotRouter | `0x3d3e4f0523500f95039d0fe600acf2ade4b06eb9` |

### Cross-chain / Intents

| Protocol | Contract | Address |
|----------|----------|---------|
| Bungee | BungeeGateway | `0x1a2f1085a94de6fbcc334aae1ddf527c567b75e7` |
| Relay (v3) | v3RelayRouter | `0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f` |
| Relay (v2.1) | v2.1RelayRouter | `0x3ec130b627944cad9b2750300ecb0a695da522b6` |

### Looking up other protocols

The protocols repo has 1400+ contract entries across 60+ DEXes, lending markets, perps, and bridges. To find a router for a protocol not listed above:

```bash
# Filter the summary CSV by protocol name
curl -s https://raw.githubusercontent.com/monad-crypto/protocols/main/protocols-mainnet.csv \
  | awk -F, -v p='Aave' 'tolower($1) ~ tolower(p) { print }'

# Or read the per-protocol JSON
curl -s https://raw.githubusercontent.com/monad-crypto/protocols/main/mainnet/aave.json | jq .addresses
```

## ERC-8004 (Trustless Agents — same on mainnet & testnet)

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

Agents that register an on-chain identity via ERC-8004 can pair the registration with a scoped Zerion agent token (`zerion agent create-token --wallet <bot> --policy <monad-only-policy>`) to bind off-chain operating credentials to the on-chain identity.

## Common Blockers

- **Wrong network.** Mainnet and testnet share some canonicals (Multicall3, Permit2, ERC-8004) but bridged stablecoin addresses differ. Always verify with `cast code` against the RPC for the network you intend to use (`https://rpc.monad.xyz` for mainnet).
- **Address looks right but `eth_getCode` returns `0x`.** The contract isn't deployed on that network. Stop and re-source the address from `monadscan.com`.
- **Symbol clash.** Multiple "USDC" tokens may exist as bridged variants. Prefer passing the explicit address from the table over the symbol when value is at stake.
- **`unsupported_chain` from Zerion CLI.** Confirm `monad` appears in `zerion chains`. If not, update `zerion-cli` to the latest release.

## Related Skills

- **zerion-trading** — `swap`, `bridge`, `send` on Monad with these addresses
- **zerion-sign** — EIP-712 signing against Permit2 on Monad
- **zerion-analyze** — `zerion analyze <addr> --chain monad` to inspect any address before interacting
- **zerion-agent-management** — chain-locked policies (`--chains monad`) for Monad-only agent tokens
