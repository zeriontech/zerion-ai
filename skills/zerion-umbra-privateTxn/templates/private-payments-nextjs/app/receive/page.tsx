"use client";

// Receive flow — scan + claim with the production-grade batching
// pattern (mirroring frontend-core/src/utxo/services/claim-utxo-service):
//
//   1. Scan returns four UTXO categories: receiver (encrypted-balance
//      target), publicReceived (public-balance target — claimable to
//      ATA), selfBurnable (sender's own ETA-source self-claimable),
//      publicSelfBurnable (sender's own ATA-source self-claimable).
//   2. Filter out UTXOs already in our local claimed-index store
//      (avoids redundant relayer calls when the indexer hasn't yet
//      caught up with the on-chain nullifier burn).
//   3. Claim service groups by type, batches receivers in chunks of 4,
//      claims self-types one-at-a-time, and falls back to single-UTXO
//      claim on `NullifierAlreadyBurnt` to avoid losing a whole batch
//      to one stale UTXO.
//   4. After each successful claim, persist the utxoId to the
//      claimed-index store so subsequent scans skip it.
//
// Critical rules:
//   - 6: scanner uses the connected wallet's signer (handled by ScanWorker).
//   - 8: scanner takes U32 (bigint) positionally.
//   - 3: claim is idempotent — DUPLICATE_OFFSET / NullifierAlreadyBurnt
//     treated as success.
//
// Privacy note (privacy.md): receive UI is MANUAL — no auto-claim.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getClaimableUtxoScannerFunction,
} from "@umbra-privacy/sdk";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { PrivacyTierBadge } from "@/components/PrivacyTierBadge";
import { ScanWorkerStatus } from "@/components/ScanWorker";
import { useUmbraSession } from "@/app/providers";
import { loadCursor } from "@/lib/scan-cursor";
import { formatSdkErrorString } from "@/lib/format-error";
import { claimBatch, type ClaimableUtxo, type ClaimResult } from "@/lib/claim-service";
import {
  loadClaimed,
  addClaimed,
  filterUnclaimed,
} from "@/lib/claimed-index-store";

interface ScannedSummary {
  receiver: ClaimableUtxo[];
  selfBurnable: ClaimableUtxo[];
  total: number;
}

export default function ReceivePage() {
  const { client, selectedAccount } = useUmbraSession();
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanned, setScanned] = useState<ScannedSummary | null>(null);
  const [results, setResults] = useState<readonly ClaimResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!client || !selectedAccount) return;
    setRefreshing(true);
    setError(null);
    setResults(null);
    try {
      const scan = getClaimableUtxoScannerFunction({ client });
      const cursor = (await loadCursor(selectedAccount.address)) ?? {
        treeIndex: 0,
        insertionIndex: 0,
      };
      // Pitfalls §8: scanner takes U32 (bigint) positionally.
      const fresh = await scan(
        BigInt(cursor.treeIndex) as never,
        0n as never,
        BigInt(cursor.insertionIndex) as never,
      );

      const claimed = await loadClaimed(selectedAccount.address);

      // Build the ClaimableUtxo list. We claim:
      //   - `received`              → receiver-claimable into ETA
      //   - `publicReceived`        → receiver-claimable into ETA (same factory)
      //   - `selfBurnable`          → self-claimable into ATA
      //   - `publicSelfBurnable`    → self-claimable into ATA (same factory)
      const toClaimable = (raw: unknown, type: "receiver" | "self"): ClaimableUtxo => {
        const r = raw as { id?: string; insertionIndex?: bigint; treeIndex?: bigint };
        const id =
          r.id ??
          (r.treeIndex !== undefined && r.insertionIndex !== undefined
            ? `${r.treeIndex}:${r.insertionIndex}`
            : `${cursor.treeIndex}:${Math.random().toString(36).slice(2)}`);
        return { raw, id, type };
      };

      const receiver = filterUnclaimed(
        [
          ...fresh.received.map((u) => toClaimable(u, "receiver")),
          ...fresh.publicReceived.map((u) => toClaimable(u, "receiver")),
        ],
        claimed,
      );
      const selfBurnable = filterUnclaimed(
        [
          ...fresh.selfBurnable.map((u) => toClaimable(u, "self")),
          ...fresh.publicSelfBurnable.map((u) => toClaimable(u, "self")),
        ],
        claimed,
      );

      setScanned({
        receiver,
        selfBurnable,
        total: receiver.length + selfBurnable.length,
      });
    } catch (e: unknown) {
      console.error("Umbra scan failed:", formatSdkErrorString(e));
      setError(formatSdkErrorString(e));
    } finally {
      setRefreshing(false);
    }
  }

  // Auto-refresh on mount + when wallet changes. Privacy.md note: this
  // only LISTS UTXOs; claiming stays manual.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selectedAccount?.address]);

  async function claim(group: "receiver" | "self" | "all") {
    if (!client || !selectedAccount || !scanned) return;
    setClaiming(true);
    setError(null);
    setResults(null);
    try {
      const utxos =
        group === "receiver"
          ? scanned.receiver
          : group === "self"
            ? scanned.selfBurnable
            : [...scanned.receiver, ...scanned.selfBurnable];
      if (utxos.length === 0) {
        setError("Nothing to claim in that group.");
        return;
      }
      const out = await claimBatch(client, utxos);
      setResults(out);

      // Persist the successfully-claimed ids so subsequent scans skip them.
      const claimedIds = out.filter((r) => r.success).map((r) => r.utxoId);
      if (claimedIds.length > 0) {
        await addClaimed(selectedAccount.address, claimedIds);
      }
      // Refresh to reflect the new claimed state.
      void refresh();
    } catch (e: unknown) {
      console.error("Umbra claim failed:", formatSdkErrorString(e));
      setError(formatSdkErrorString(e));
    } finally {
      setClaiming(false);
    }
  }

  const recvCount = scanned?.receiver.length ?? 0;
  const selfCount = scanned?.selfBurnable.length ?? 0;

  return (
    <>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/account">Account</Link>
        <Link href="/send">Send</Link>
        <Link href="/receive" className="active">Receive</Link>
      </nav>
      <h1>Receive <PrivacyTierBadge tier={1} /></h1>
      <p className="muted">
        Scanner runs in the background. Click claim when you see incoming UTXOs.
        Funds land in your encrypted balance; withdraw to any ATA you own from there.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <ScanWorkerStatus />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void refresh()} disabled={refreshing || claiming} className="secondary">
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={() => void claim("receiver")} disabled={claiming || recvCount === 0}>
              {claiming ? "Claiming…" : `Claim received (${recvCount})`}
            </button>
            <button onClick={() => void claim("self")} disabled={claiming || selfCount === 0} className="secondary">
              {claiming ? "Claiming…" : `Claim self-burnable (${selfCount})`}
            </button>
          </div>
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {results && (
            <>
              <h2>Claim results</h2>
              {results.map((r, i) => (
                <p key={`${r.utxoId}-${i}`} className="mono">
                  {r.success ? "✓" : "✗"} {r.utxoId}
                  {r.signature && ` · ${r.signature.slice(0, 16)}…`}
                  {r.error && ` · ${r.error}`}
                </p>
              ))}
            </>
          )}
        </div>
        <div className="card">
          <h2>Privacy notes</h2>
          <ul>
            <li>Claiming into your encrypted balance keeps your identity hidden.</li>
            <li>Receiver-claimable timing breaks correlation: claim whenever you want.</li>
            <li>Withdrawing later to an ATA reveals only the withdrawal amount.</li>
            <li>This page does NOT auto-claim. Manual + delayed is the privacy-correct default.</li>
          </ul>
        </div>
      </RegistrationGate>
    </>
  );
}
