
# Zerion — Off-chain Signing

Produce signatures **without broadcasting a transaction**. Used for login flows, permits, and signed orders. The signature is the output — you hand it to the verifying party (a dapp, relayer, exchange, etc.).

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the parent `SKILL.md` (Setup + Authentication). Signing requires an agent token (used as the wallet passphrase). For setup → `capabilities/agent-management.md`.

## When to use

- **SIWE** ("Sign-In with Ethereum") login flows
- **EIP-2612 `permit`** — gasless ERC-20 approvals
- **Permit2** approvals
- **Seaport / OpenSea** off-chain orders
- Any dapp asking "please sign this message" or "please sign this typed data"
- Identity attestations, DAO snapshot voting

For on-chain transactions (swap/bridge/send) → `capabilities/trading.md`.

## Signing route

Message signing follows the same route model as trading (`capabilities/trading.md` § "Signing routes
& web-app handoff"), minus the value threshold — a message has no sell-side value. A **read-only
wallet** or the **`--review`** flag hands the message off to the web app (a connected wallet signs
in the browser; the returned signature is verified against the signer address); everything else signs
locally. On the handoff path **no agent token is required**. Messages are signed one at a time —
they are **not** bundleable (see `capabilities/bundle.md`).

## Sign a message

```bash
# EIP-191 personal_sign (EVM)
zerion sign-message "hello" --chain ethereum
zerion sign-message "hello" --chain base --wallet <name>
zerion sign-message "gmonad" --chain monad

# Raw hex bytes (no prefix, used by some wallets)
zerion sign-message 0xdeadbeef --encoding hex --chain ethereum

# Raw ed25519 (Solana)
zerion sign-message "hello" --chain solana

# Explicit flags
zerion sign-message --message "text" --wallet <name> --chain <chain>
```

`<chain>` determines the signing scheme: EVM chains use EIP-191 personal_sign; Solana uses raw ed25519.

## Sign typed data (EIP-712, EVM only)

EIP-712 typed data requires a JSON object with `{ domain, types, primaryType, message }`. Include `EIP712Domain` in `types` when the verifier expects it.

```bash
# Inline JSON
zerion sign-typed-data --data '{"domain":{...},"types":{...},"primaryType":"Permit","message":{...}}' --chain base

# From file
zerion sign-typed-data --file permit.json --chain ethereum

# From stdin
cat permit.json | zerion sign-typed-data --chain ethereum
```

Output is a JSON object with the signature (`r`, `s`, `v` for EVM) on stdout.

## Setup safety net

If no agent token is configured and stderr is a TTY, the CLI offers:

```
Want to setup an agent token for "<wallet>"? [Y/n]
```

…and runs `agent create-token` inline. After that completes, the original `sign-*` command continues with the fresh token. In non-TTY contexts (CI, piped) the command fails fast with `no_agent_token` — pre-create the token with `agent create-token --passphrase-file <0600-path>` (see `capabilities/agent-management.md`).

## Security

Signing arbitrary messages or typed data can authorize **unlimited token allowances** (e.g. a malicious permit). Before signing:

1. Verify the **domain** (chain ID, contract address, name, version) matches the dapp you intended to interact with.
2. Verify the **primaryType** matches the action you expected (`Permit`, `OrderComponents`, etc.).
3. For `permit`-style payloads, check the **spender, value, and deadline** explicitly.

The CLI doesn't enforce semantic checks — it signs whatever is passed. Apply policies (`capabilities/agent-management.md`) to restrict which contracts can be signed for if needed.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `no_agent_token` | No agent token | `capabilities/agent-management.md` skill |
| `invalid_typed_data` | Missing `domain`/`types`/`primaryType`/`message` | Validate the JSON shape |
| `unsupported_chain` | Invalid `--chain` | `zerion chains` |
| `wallet_not_found` | Wallet not in vault | `zerion wallet list` |
