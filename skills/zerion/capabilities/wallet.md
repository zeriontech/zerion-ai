
# Zerion — Wallet Management

Two kinds of wallet:

- **Keystore wallets** — encrypted locally in the Open Wallet Standard (OWS) vault at `~/.ows/`, AES-256-GCM. Keys never leave the device, and signing happens on this machine.
- **Read-only wallets** — a name + address with no key material, in `~/.zerion/readonly-wallets.json`. Reads work normally; **signing routes to the web app** (see below).

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the parent `SKILL.md` (Setup + Authentication).

## When to use

- "Create a new wallet"
- "Import my wallet from a private key / mnemonic"
- "Track my Ledger / hardware / exchange address" / "add my wallet without giving up the keys"
- "Ask me before anything big" / "require my approval for trades over $500"
- "Show my wallets" / "list deposit addresses"
- "Back up my recovery phrase"
- "Export the raw private key" / "give me the 0x hex key" / "give me the Phantom-format secret"
- "Delete this wallet"
- "Sync my wallet to the Zerion mobile app"

For on-chain actions with a wallet → `capabilities/trading.md`. For agent-token setup on a wallet → `capabilities/agent-management.md`.

### Wallets and chains

A mnemonic-derived wallet (created via `wallet create` or `wallet import --mnemonic`) holds **both** an EVM and a Solana account, so the same wallet can sign on either chain and act as a destination for cross-chain bridges in either direction.

A wallet imported from a single private key holds only one chain's account:

| Import flag | Account type | Can swap on | Can be cross-chain destination for |
|-------------|--------------|-------------|-------------------------------------|
| `--mnemonic` | EVM + Solana | both | both |
| `--evm-key` | EVM only | EVM chains | EVM chains |
| `--sol-key` | Solana only | Solana | Solana |

`wallet list` shows which accounts each wallet has. Use this when picking `--to-wallet` for a cross-chain bridge — the destination wallet must have an account on the target chain.

## Read-only wallets — signing goes through the browser

A **read-only wallet** is a first-class saved wallet with **no secret material** — just a name + an
address. Add one for an address whose keys live somewhere else (hardware wallet, mobile app, exchange,
a multisig you co-sign):

```bash
zerion wallet add 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --name ledger
zerion wallet add vitalik.eth --name vitalik      # ENS is resolved once, at add time
zerion wallet add 8xLdox…  --name sol-cold        # base58 → a Solana read-only wallet
```

It shows up in `wallet list` and read commands work normally. What changes is signing: because there
is no key to sign with, **every** transaction and message signature routes to the **web-app handoff**
— the CLI builds the request, opens an `app.zerion.io` link, and waits for a connected wallet to
sign in the browser (`capabilities/trading.md` § "Signing routes & web-app handoff"). Consequences
worth knowing before you plan a flow:

- Trades on a read-only wallet **cannot run unattended** — a human has to sign in the browser.
- No agent token is needed on the handoff path (there's no keystore to unlock).
- The stored address's ecosystem fixes which chains it can sign for — an EVM (`0x…`) read-only wallet
  refuses `--chain solana` with `readonly_chain_mismatch`, and vice versa.
- `wallet backup` / `wallet export-key` error clearly — there is no key material to export.
- `consolidate --execute` signs locally and so **cannot work** on a read-only wallet — it still demands
  an agent token first (`no_agent_token`, exit 1, if none is configured), and once past that gate every
  row fails with a keystore error while the command exits 0. Sweep it with
  `zerion bundle --group "$(zerion consolidate <chain> <token> --prepare)"` instead (`capabilities/bundle.md`).

This is distinct from the **watchlist** (`zerion watch`), which is for observing wallets that aren't
yours — a watched address is not a wallet and can't be a signer. Use `wallet add` when the user calls
it *their* wallet.

## Review threshold — auto-sign small, ask a human for big

A per-wallet USD ceiling on unattended signing. Any transaction whose **sell-side** value exceeds it
routes to the web-app handoff for human review instead of auto-signing:

```bash
zerion wallet set-review-threshold trading-bot 500     # over $500 → human review in the browser
zerion wallet set-review-threshold trading-bot 0       # review everything with any priced value
zerion wallet set-review-threshold trading-bot off     # always auto-sign (the default; `none` / `unset` also work)
```

- Stored as `reviewThresholds` in `~/.zerion/config.json`. Unset / `off` = no threshold, always auto-sign.
- Works on both keystore and read-only wallets (a read-only wallet already routes everything to review, so the threshold is redundant there).
- **Sell-side value only** — send = amount × price; swap/bridge = the quote's sell side; an approve
  inherits its bundle's value; gas never counts.
- **Fails closed:** if the value can't be priced while a threshold is set, the trade routes to review
  rather than auto-signing. An unpriced token is not a bypass.
- Messages have no USD value, so `sign-message` / `sign-typed-data` ignore the threshold — only the
  read-only and `--review` triggers apply there (`capabilities/sign.md`).
- This is the human-in-the-loop guardrail; the machine-enforced ones (chain allowlists, deny
  transfers/approvals) are agent policies → `capabilities/agent-management.md`. They compose.

## Agent vs manual operations

| Operation | Type | Notes |
|-----------|------|-------|
| `wallet list`, `wallet fund` | **Agent** | Read-only. Safe to invoke autonomously. |
| `wallet add` | **Agent** | Address-only, no secrets. Safe to invoke, but understand it makes every signature go through the browser. |
| `wallet set-review-threshold` | **Agent** | Config-only. Safe to invoke; confirm the USD amount with the user first. |
| `wallet create`, `wallet import`, `wallet backup`, `wallet export-key`, `wallet delete`, `wallet sync` | **Manual** | Require passphrase or interactive input. Humans must run these directly — agents must not call them. |

## Safe for agents — no secrets, no prompts

```bash
zerion wallet list                        # All wallets (keystore + read-only), addresses, active policies
zerion wallet list --search <query>       # Filter by name or address
zerion wallet list --limit <n> --offset <n>   # Paginate
zerion wallet fund --wallet <name>        # Show EVM + Solana deposit addresses
zerion wallet add <address|ens> --name <name>          # Add a read-only wallet (see above)
zerion wallet set-review-threshold <wallet> <usd|off>   # Human-review ceiling (see above)
```

## Manual — humans only

These prompt for a passphrase, secret key, or confirmation. **Do not invoke from an agent loop.**

```bash
# Create a fresh encrypted wallet (EVM + Solana, generated locally)
zerion wallet create --name <name>

# Import from existing keys (interactive secret prompts — never expose keys in shell history)
zerion wallet import --name <name> --evm-key
zerion wallet import --name <name> --sol-key
zerion wallet import --name <name> --mnemonic

# Export the recovery phrase (passphrase required)
zerion wallet backup --wallet <name>

# Export raw private key(s) derived from the mnemonic (passphrase required)
# Output goes to stderr only — same safety stance as `wallet backup`.
zerion wallet export-key --wallet <name>                       # both chains, derivation index 0
zerion wallet export-key --wallet <name> --chain evm           # EVM only — m/44'/60'/0'/0/0, 0x hex
zerion wallet export-key --wallet <name> --chain solana        # Solana only — m/44'/501'/0'/0', base58 (Phantom format) + 32-byte ed25519 seed
zerion wallet export-key --wallet <name> --chain evm --index 1 # different derivation index

# Permanently delete (passphrase + confirmation)
zerion wallet delete <name>

# Sync to the Zerion mobile app via a one-time QR code
zerion wallet sync --wallet <name>
zerion wallet sync --all
```

## Setting defaults

Wallet-related config is set with `zerion config`:

```bash
zerion config set defaultWallet <name>    # Used when --wallet is omitted
zerion config get defaultWallet
zerion config unset defaultWallet         # Resets to "no default"
zerion config list                        # Show all config (sensitive values redacted)
```

`~/.zerion/config.json` is created with mode 0o600.

## Typical setup flow (human runs these in order)

```bash
# 1. Create wallet (passphrase prompt; offers agent-token setup at the end)
zerion wallet create --name agent-bot

# 2. Fund it
zerion wallet fund --wallet agent-bot
# → prints EVM and Solana deposit addresses

# 3. Set as default so future commands omit --wallet
zerion config set defaultWallet agent-bot

# 4. (Optional) sync to mobile
zerion wallet sync --wallet agent-bot
```

After step 1's agent-token prompt, the wallet is ready for autonomous trading via `capabilities/trading.md`. To configure agent tokens or policies later → `capabilities/agent-management.md`.

## Common errors

| Code | Cause | Fix |
|------|-------|-----|
| `wallet_exists` | Wallet name already taken | Choose a different name or `wallet delete` first |
| `wallet_not_found` | Name not in OWS vault | `zerion wallet list` to see existing |
| `bad_passphrase` | Wrong passphrase entered | Retry; passphrase is set at creation |
| `bad_mnemonic` | Invalid recovery phrase format | Re-enter; must be valid BIP-39 |
| `bad_evm_key` | Invalid 0x-prefixed hex | Should be 64 hex chars after `0x` |
| `bad_sol_key` | Invalid base58 keypair | Solana keys are base58, ≥87 chars |
| `name_in_use` | `wallet add` name already taken by a keystore wallet | Pick another `--name` |
| `readonly_invalid_address` | `wallet add` value isn't a 0x address, `.eth` name, or base58 pubkey | Check the address format |
| `ens_resolve_failed` | ENS name didn't resolve to an EVM address | Verify the name, or pass the raw `0x` address |
| `readonly_chain_mismatch` | Read-only wallet's ecosystem ≠ the requested chain | EVM wallet → EVM `--chain`; Solana wallet → `--chain solana` |
| `invalid_threshold` | `set-review-threshold` value isn't a non-negative USD number or `off` | e.g. `500` or `off` |
