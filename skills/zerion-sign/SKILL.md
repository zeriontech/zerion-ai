---
name: zerion-sign
description: "Off-chain signing via the Zerion CLI: sign-message (EIP-191 EVM, raw ed25519 Solana) and sign-typed-data (EIP-712). Use when the user asks to sign a message, login with SIWE, sign a permit, approve an off-chain order, or sign typed data — anything that produces a signature without broadcasting a transaction. Requires an agent token. Pair with `zerion-agent-management` to set one up."
license: MIT
allowed-tools: Bash
---

# Zerion — Off-chain Signing

Produce signatures **without broadcasting a transaction**. Used for login flows, permits, and signed orders. The signature is the output — you hand it to the verifying party (a dapp, relayer, exchange, etc.).

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the `zerion` umbrella skill. Signing requires an agent token (used as the wallet passphrase). For setup → `zerion-agent-management`.

## When to use

- **SIWE** ("Sign-In with Ethereum") login flows
- **EIP-2612 `permit`** — gasless ERC-20 approvals
- **Permit2** approvals
- **Seaport / OpenSea** off-chain orders
- Any dapp asking "please sign this message" or "please sign this typed data"
- Identity attestations, DAO snapshot voting

For on-chain transactions (swap/bridge/send) → `zerion-trading`.

## Sign a message

```bash
# EIP-191 personal_sign (EVM)
zerion sign-message "hello" --chain ethereum
zerion sign-message "hello" --chain base --wallet <name>

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

…and runs `agent create-token` inline. After that completes, the original `sign-*` command continues with the fresh token. In non-TTY contexts (CI, piped) the command fails fast with `no_agent_token` — see `zerion-agent-management`.

## Security

Signing arbitrary messages or typed data can authorize **unlimited token allowances** (e.g. a malicious permit). Before signing:

1. Verify the **domain** (chain ID, contract address, name, version) matches the dapp you intended to interact with.
2. Verify the **primaryType** matches the action you expected (`Permit`, `OrderComponents`, etc.).
3. For `permit`-style payloads, check the **spender, value, and deadline** explicitly.

The CLI doesn't enforce semantic checks — it signs whatever is passed. Apply policies (`zerion-agent-management`) to restrict which contracts can be signed for if needed.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `no_agent_token` | No agent token | `zerion-agent-management` skill |
| `invalid_typed_data` | Missing `domain`/`types`/`primaryType`/`message` | Validate the JSON shape |
| `unsupported_chain` | Invalid `--chain` | `zerion chains` |
| `wallet_not_found` | Wallet not in vault | `zerion wallet list` |
