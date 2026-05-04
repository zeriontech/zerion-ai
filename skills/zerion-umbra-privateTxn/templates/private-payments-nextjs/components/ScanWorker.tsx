"use client";

// Background scan loop. Persists the (treeIndex, insertionIndex)
// cursor in IndexedDB and resumes incrementally on reload.
// Critical rule 6: the scanner uses the CONNECTED wallet's signer
// (the receiver scans for UTXOs sent to their own address).
// Critical rule 8: pass the saved cursor as startInsertionIndex; the
// scanner is positional — scan(treeIndex, start, end?).

import { useEffect, useRef, useState } from "react";
import { getClaimableUtxoScannerFunction } from "@umbra-privacy/sdk";
import { useUmbraSession } from "@/app/providers";
import { loadCursor, saveCursor } from "@/lib/scan-cursor";

const CHUNK = 10_000;
const POLL_MS = 12_000;

interface ScanResultSummary {
  selfBurnable: number;
  received: number;
  publicSelfBurnable: number;
  publicReceived: number;
  treeIndex: number;
  insertionIndex: number;
  lastScanAt: number;
}

export function useScanWorker() {
  const { client, selectedAccount } = useUmbraSession();
  const [summary, setSummary] = useState<ScanResultSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!client || !selectedAccount) return;
    stoppedRef.current = false;

    const scan = getClaimableUtxoScannerFunction({ client });

    async function tick() {
      try {
        const cursor = (await loadCursor(selectedAccount!.address)) ?? {
          treeIndex: 0,
          insertionIndex: 0,
        };
        const start = cursor.insertionIndex;
        const end = start + CHUNK;
        // Pitfalls §8: scanner takes U32 (bigint) positionally — never plain numbers.
        const result = await scan(
          BigInt(cursor.treeIndex) as never,
          BigInt(start) as never,
          BigInt(end) as never,
        );
        if (stoppedRef.current) return;

        const counts = {
          selfBurnable: result.selfBurnable.length,
          received: result.received.length,
          publicSelfBurnable: result.publicSelfBurnable.length,
          publicReceived: result.publicReceived.length,
        };

        await saveCursor(selectedAccount!.address, {
          treeIndex: cursor.treeIndex,
          insertionIndex: end,
        });
        setSummary({
          ...counts,
          treeIndex: cursor.treeIndex,
          insertionIndex: end,
          lastScanAt: Date.now(),
        });
      } catch (e: unknown) {
        if (!stoppedRef.current) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(id);
    };
  }, [client, selectedAccount]);

  return { summary, error };
}

export function ScanWorkerStatus() {
  const { summary, error } = useScanWorker();
  if (error) return <p className="error">Scan error: {error}</p>;
  if (!summary) return <p className="muted">Scanner starting…</p>;
  return (
    <p className="muted">
      Last scan: tree {summary.treeIndex}, up to leaf {summary.insertionIndex.toLocaleString()} ·{" "}
      {summary.received + summary.publicReceived} received · {summary.selfBurnable + summary.publicSelfBurnable} self-burnable
    </p>
  );
}
