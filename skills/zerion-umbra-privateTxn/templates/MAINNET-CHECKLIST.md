# Mainnet pre-flight checklist

Tick every box BEFORE deploying this app to a domain real users will see.
Missing any one of these has broken integrations in the past.

## Environment + dependencies

- [ ] `package.json` pins `@umbra-privacy/sdk` and
      `@umbra-privacy/web-zk-prover` to exact versions (no `^`, no `~`).
- [ ] `NEXT_PUBLIC_RPC_URL` points at a **paid / private** Solana RPC
      (Helius, Triton, QuickNode, Alchemy). Free public endpoints will
      rate-limit under any real load and cause silent scan stalls.
- [ ] `NEXT_PUBLIC_RPC_WS_URL` is set if your RPC provider needs an
      explicit WebSocket URL (most do). Missing this → no
      `confirmTransaction` round-trips.
- [ ] `NEXT_PUBLIC_NETWORK` matches the cluster your RPC points at.
- [ ] `NEXT_PUBLIC_DEFAULT_MINT` is on the supported-tokens list. Confirm
      via the SDK's exported `SUPPORTED_MINTS` or
      `https://sdk.umbraprivacy.com/supported-tokens`.
- [ ] `NEXT_PUBLIC_INDEXER_URL` and `NEXT_PUBLIC_RELAYER_URL` are the
      mainnet endpoints (NOT devnet). Health-check both before deploy:
      `curl <indexer>/health` and `curl <relayer>/health` should 200.

## Master-seed storage decision

The scaffold defaults to **re-derive every session** — no persistence,
zero attack surface. The user signs the magic message once per visit.

If you swap in persistent storage to skip the re-sign:

- [ ] Storage is **encrypted at rest** with a key the user controls
      (WebAuthn-derived, password-derived via Argon2id, or wallet-signed
      challenge). NEVER plaintext localStorage / IndexedDB.
- [ ] Storage is **scoped per-wallet** (key includes the wallet
      pubkey). A wallet swap MUST NOT load the previous wallet's seed.
- [ ] You have a documented rotation procedure (see `advanced.md` §3).

## Privacy guards

- [ ] Privacy-tier badge is rendered on every flow that constructs a
      UTXO (send + claim). Tier 3 (ATA→ATA) flows show a warning banner.
- [ ] Same-wallet round-trip is blocked: claiming back to the source
      ATA should refuse to sign with a clear error message.
- [ ] `optionalData` accepts only pre-hashed 32-byte values. Any
      plaintext-string callers are rejected at the API boundary
      (zod-validated).
- [ ] Receiver-claimable is the **default**; self-claimable requires an
      explicit toggle with a "delay your claim for stronger privacy"
      warning shown to the user.

## Operational correctness

- [ ] Tested register → deposit → create UTXO → scan → claim end-to-end
      on **devnet** with two separate wallets (sender + recipient).
- [ ] Tested claim retry: while a claim is in flight (status
      `submitted` or `awaiting_callback`), kill the tab. Reopen and
      verify the claim queue resumes via `request_id` and does NOT
      re-spend the nullifier. `DUPLICATE_OFFSET` 409 response is treated
      as success.
- [ ] Tested wallet swap mid-session: switching wallets in the in-app
      modal re-keys `UmbraClientProvider`. The stale signer never
      derives a seed for the new wallet.
- [ ] Scan cursor `(treeIndex, insertionIndex)` is persisted per address
      in IndexedDB and resumes correctly across reloads.
- [ ] App boots cleanly with empty `.env.local` (zod throws a helpful
      error, not a silent undefined).

## ZK prover

- [ ] `getZkProverSuiteFromAssetUrls` resolves under your production
      CSP. `script-src` and `connect-src` must allow the Umbra CDN host
      OR you have self-hosted the assets (see `advanced.md` §5).
- [ ] Prover runs in a **Web Worker** (the scaffold uses comlink). The
      main thread must NEVER block on Groth16 proof generation — that
      causes 2–8s frame drops.

## Hosting

- [ ] CSP allows wallet-adapter popups. On Vercel, `next.config.js`
      `headers` already includes `frame-ancestors 'self'` and the
      wallet-standard origins; verify your reverse proxy doesn't strip
      it.
- [ ] HTTPS only. WalletStandard refuses to expose features over HTTP
      except on `localhost`.
- [ ] Build size: run `npm run build` and confirm the client bundle is
      under 1 MB gzipped. The SDK + ZK prover are the bulk; if larger,
      check tree-shaking and that you're not importing
      `@umbra-privacy/sdk/crypto/poseidon` etc. directly.

## Day-2 readiness (not blocking but recommended)

- [ ] One-click rollback path: pinned package versions + git-tagged
      releases. If a relayer-side change breaks this app, you can
      redeploy the previous commit.
- [ ] Founder has the SDK changelog URL bookmarked and a process for
      reviewing it before bumping the pin.
- [ ] You have a way to reach the user when their UTXO is stuck. The
      scaffold's `/receive` page surfaces claim status; consider an
      email/Discord channel for support.
