# Scaffold recipe — private payments (Next.js)

This file is read by Claude Code only AFTER the user has explicitly
confirmed scaffold-intent (see SKILL.md "Scaffolding mode"). The steps
below are deterministic — execute them in order without skipping.

## When to enter scaffolding mode

Enter scaffolding mode ONLY when both are true:

1. The user's prompt contains an explicit build verb (`build`, `scaffold`,
   `create`, `start`, `set up`, `generate`, `bootstrap`) paired with a
   project noun (`app`, `MVP`, `starter`, `project`, `Next.js app`,
   `payments app`).
2. You have asked the user via `AskUserQuestion` *"Do you want me to
   scaffold a new Umbra Next.js app from the template, or are you in
   reference mode?"* and they picked the scaffold option.

Do NOT enter scaffolding mode for:

- "load the Umbra skill" / "I'm working with Umbra" → reference mode.
  These trigger the skill but are NOT build-intent.
- "explain X / how does Y work" → reference mode (load `flows.md` etc.).
- "fix / debug / review my Umbra code" → reference mode.
- "add Umbra to my existing app" → ask the user first whether they want
  the full scaffold or just snippets; if snippets, stay in reference mode.
- Bare keyword hits (`umbra`, `payments`, `UTXO`, `master seed`) without
  a build verb → reference mode.

If you are unsure whether the user wants to scaffold, the answer is
**don't scaffold** — ask first. A wrong scaffold is much more disruptive
than a wrong reference load.

## Step 1 — Confirm intent + collect 3 inputs

Use `AskUserQuestion`. One question per concern, defaults pre-selected:

1. **Target directory name** — default `umbra-payments-app`. Free-text.
2. **Network** — `mainnet-beta` (default) or `devnet`. Single-select.
3. **Default token mint** — defaults:
    - `mainnet-beta` → USDC mainnet
      `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
    - `devnet`       → dUSDC (only dUSDC and dUSDT are pool-deployed on devnet)
      `4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7`
      Devnet faucet: https://faucet.umbraprivacy.com/

  Free-text "other" allowed but on devnet picking anything other than
  dUSDC or dUSDT will fail with Anchor 3012 (pitfalls.md §13). The
  scaffold's `lib/supported-mints.ts` ships both devnet mints; encourage
  the founder to pick from there.

## Step 2 — Copy the template

Source: `.agents/skills/umbra-sdk/templates/private-payments-nextjs/`
Destination: `<cwd>/<target-dir>/`

Copy every file recursively. Do not skip dotfiles (`.env.example`,
`.gitignore`, `.eslintrc.json`, `.npmrc`).

## Step 3 — Token-substitute

Replace these placeholders across all copied files (`package.json`,
`README.md`, `.env.example`, `app/layout.tsx`, `app/page.tsx`):

- `__APP_NAME__` → target dir name (in `package.json`, `app/layout.tsx`,
  `app/page.tsx`, `README.md`).
- `__NETWORK__` → `mainnet-beta` | `devnet`.
- `__DEFAULT_MINT__` → chosen mint address.
- `__DEFAULT_RPC__`:
    - `mainnet-beta` → leave the placeholder
      `https://CHANGE_ME.solana-mainnet.example.com` so the founder
      MUST replace it with a paid RPC before running.
    - `devnet` → `https://api.devnet.solana.com`.
- `__DEFAULT_INDEXER__` (browser-facing `NEXT_PUBLIC_INDEXER_URL`, called
  directly — no proxy. Returns **protobuf**, not JSON):
    - `mainnet-beta` → `https://utxo-indexer.api.umbraprivacy.com`
    - `devnet`       → `https://utxo-indexer.api-devnet.umbraprivacy.com`
- `__DEFAULT_RELAYER__` (browser-facing `NEXT_PUBLIC_RELAYER_URL`, called
  directly — no proxy):
    - `mainnet-beta` → `https://relayer.api.umbraprivacy.com`
    - `devnet`       → `https://relayer.api-devnet.umbraprivacy.com`
- `__DEFAULT_DATA_INDEXER__` (server-only `DATA_INDEXER_UPSTREAM`,
  proxied via `/proxy/data-indexer`. Returns **JSON**):
    - `mainnet-beta` → `https://data-indexer.api.umbraprivacy.com`
    - `devnet`       → `https://data-indexer.api-devnet.umbraprivacy.com`

Browser-facing `NEXT_PUBLIC_DATA_INDEXER_URL` in `.env.example` always
stays as `/proxy/data-indexer` — do NOT substitute it. The proxy is set
up in `next.config.ts`. UTXO-indexer and relayer are NOT proxied — the
browser hits their absolute URLs directly.

## Step 4 — Print next steps + checklist

Print, in the chat, a short message containing:

```
Scaffolded <target-dir> for the <network> network.

Next steps:
  cd <target-dir>
  cp .env.example .env.local
  # edit .env.local — set NEXT_PUBLIC_RPC_URL to a paid Solana RPC
  npm install
  npm run dev

Open http://localhost:3000, connect a Solana wallet, and walk:
  /account → register on Umbra
  /send    → deposit + create receiver-claimable UTXO
  /receive → scan + claim

Devnet smoke test BEFORE mainnet — see README.md "Mainnet checklist".
```

Then append the FULL contents of
`.agents/skills/umbra-sdk/templates/MAINNET-CHECKLIST.md` inline so the
founder reads it before deploying.

## Step 5 — STOP

Do NOT run `npm install`, `npm run dev`, or any other command unless
the user explicitly asks. The scaffold is self-contained; the founder
should drive the install + first run themselves so they catch env
issues early.

## Note on the published peer-dep mismatch

`@umbra-privacy/web-zk-prover@2.0.1` declares an outdated peer-dep on
`@umbra-privacy/sdk@2.0.3`, while the scaffold pins
`@umbra-privacy/sdk@4.0.0`. The published API is compatible — only the
peer-dep range is stale. The scaffold's `package.json` ships a small
`overrides` block that resolves only that mismatch:

```json
"overrides": {
  "@umbra-privacy/web-zk-prover": {
    "@umbra-privacy/sdk": "$@umbra-privacy/sdk"
  }
}
```

This lets npm auto-install other peer-deps normally — including
`snarkjs`, which web-zk-prover wraps internally. The scaffold does NOT
declare `snarkjs` directly; it lands transitively. Drop the `overrides`
once a newer web-zk-prover ships with a matching peer-dep range.
