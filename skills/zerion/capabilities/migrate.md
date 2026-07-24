
# Zerion — Provider Migration

Migrate a codebase off another wallet-data provider (Zapper, Dune SIM, DeBank, Allium, OneBalance, and any provider added later) onto the Zerion REST API, using Zerion's official migration guides as the single source of truth.

This capability contains **no endpoint mappings of its own**. Every parity table, field mapping, and code sample is fetched live from [developers.zerion.io](https://developers.zerion.io), so it never goes stale and never disagrees with the docs.

**Golden rule:** never map an endpoint or field from memory. If your prior knowledge and the fetched guide disagree, the guide wins. If the guide doesn't cover something, say so explicitly instead of guessing.

## Setup

- `curl` for fetching docs pages, `rg` (ripgrep) for the inventory step (falls back to `grep -r`)
- `ZERION_API_KEY` for verification calls — see the parent `SKILL.md` (Authentication)
- Optional: the `zerion` CLI for one-shot verification (`zerion analyze <address>`)

## When to use

- "Migrate us from Zapper / SIM / DeBank / Allium / OneBalance to Zerion"
- A provider announced a shutdown or sunset and the codebase still calls it
- Any request to replace wallet balances, DeFi positions, transaction history, NFT, or price calls from another provider with Zerion API

## How to read the docs

Every page on developers.zerion.io serves raw markdown when you append `.md` to its path:

```bash
curl -s https://developers.zerion.io/llms.txt                       # full page index
curl -s https://developers.zerion.io/migrate-to-zerion.md           # migration hub: list of supported providers
curl -s https://developers.zerion.io/migrate-from-<provider>.md     # a provider's full migration guide
```

Links inside a guide are relative docs paths (e.g. `/api-reference/wallets/get-wallet-fungible-positions`, `/webhooks`). Fetch any of them the same way: prepend `https://developers.zerion.io` and append `.md`.

## Workflow

### 1. Resolve the provider

Fetch `https://developers.zerion.io/migrate-to-zerion.md` to get the current list of supported providers and their guide URLs.

- If the user already named a provider on the list, use its guide without asking.
- Otherwise, ask the user to pick their provider from the fetched list (one question, one answer; include an "other" option). Don't try to auto-detect it from the codebase.
- If the provider isn't on the list, there is no guide to follow. Offer a best-effort manual migration using the [API reference](https://developers.zerion.io/api-reference) and tell the user to contact api@zerion.io (or the chat widget on [dashboard.zerion.io](https://dashboard.zerion.io)) so Zerion can help directly.

If the guide opens with a discount or sunset note (many do), relay it to the user verbatim.

### 2. Fetch the guide and use it as the plan

`curl -s https://developers.zerion.io/migrate-from-<provider>.md`

Every guide follows the same skeleton. Use it as your migration plan:

- **Endpoint parity** table: one row per use case, provider endpoint on one side, Zerion endpoint on the other. This is your unit of work.
- **Per-use-case sections** (token balances, DeFi positions, transactions, NFTs, prices, …): side-by-side code samples and **Field mapping** / **Filter mapping** tables. These are the rewrite instructions.
- **Pagination** section: how the provider's paging translates to Zerion's.
- **Differences from \<Provider\>** section: what does not carry over 1:1. This drives step 5.

When a rewrite needs response-schema detail beyond what the guide shows, follow the guide's own link to the endpoint's API reference page (append `.md`) rather than inventing field names.

### 3. Inventory every provider call site

Build the search patterns from what step 2 fetched, not from memory: the provider's hostnames, endpoint paths, GraphQL operation names, SDK package names, and API-key env vars, as they appear in the guide. Then, from the repo root:

```bash
rg -n --hidden -g '!node_modules' -g '!.git' -e '<pattern1>' -e '<pattern2>' ...
```

For each hit, note which provider field the code actually reads and whether it's a raw HTTP call or a generated SDK client (raw calls become REST `fetch`/`requests` calls; SDK clients may need a thin adapter). Group hits by use case using the parity table before touching code.

### 4. Rewrite, use case by use case

For each parity-table row with call sites:

1. Start from the guide's Zerion-side code sample for that use case.
2. Translate every field the old code reads using the guide's field-mapping table. If a field the code depends on has no row in the table, treat it as a potential gap (step 5), not something to improvise.
3. Apply the guide's filter and pagination mappings to any query parameters and paging loops.
4. Keep the surrounding code's style, naming, and error handling.

Cross-cutting topics have their own pages; fetch them instead of assuming:

- [authentication.md](https://developers.zerion.io/authentication.md) for the auth scheme
- [pagination-and-filtering.md](https://developers.zerion.io/pagination-and-filtering.md) for paging in depth
- [supported-blockchains.md](https://developers.zerion.io/supported-blockchains.md) plus `GET /v1/chains/` for chain ID translation
- [webhooks.md](https://developers.zerion.io/webhooks.md) when replacing polling with realtime updates
- [rate-limits.md](https://developers.zerion.io/rate-limits.md) before running verification loops

### 5. Flag what has no Zerion equivalent

Read the guide's "Differences from \<Provider\>" section and check each item against the inventory. Anything the codebase actually uses that doesn't carry over needs an explicit decision from the user (workaround, alternative data source, or dropping the feature), never a silent omission in the rewrite. List these in your final summary even when the user didn't ask.

### 6. Verify

Run the rewritten calls against a wallet the old integration already had data for, and sanity-check against what the old provider showed:

```bash
zerion analyze <address>
# or raw REST:
curl -s "https://api.zerion.io/v1/wallets/<address>/portfolio?currency=usd" -u "$ZERION_API_KEY:"
```

Compare totals order-of-magnitude, spot-check a few transaction hashes, and re-read the guide's notes for known expected discrepancies before calling anything a bug. Mind the rate limits when verifying many call sites.

## Reporting

End with a summary the user can act on: call sites migrated per use case, call sites intentionally left (and why), gaps flagged from step 5 awaiting a decision, and verification results.
