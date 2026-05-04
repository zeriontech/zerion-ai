"use client";

// Blocks children until the connected wallet is FULLY registered on Umbra.
// Full registration requires THREE flags on-chain:
//   - isInitialised                       (step 1: account init)
//   - isUserAccountX25519KeyRegistered    (step 2: confidential — X25519 key)
//   - isUserCommitmentRegistered          (step 3: anonymous — Groth16 commitment)
//
// Checking only `isInitialised` is a footgun: if a previous run got stuck
// after step 1, the gate would mark the wallet "registered" and skip
// steps 2+3, breaking every downstream UTXO flow.
//
// Registration is idempotent + resumable — we always call register() and
// the SDK skips already-completed steps. After the call we re-query and
// require all three flags before unblocking.

import { useEffect, useState, type ReactNode } from "react";
import { getUserAccountQuerierFunction, getUserRegistrationFunction } from "@umbra-privacy/sdk";
import { useUmbraSession } from "@/app/providers";
import { registrationProver } from "@/lib/zk-prover";

type State = "loading" | "needs-registration" | "registered" | "error";

interface RegFlags {
  isInitialised: boolean;
  hasX25519: boolean;
  hasCommitment: boolean;
}

function flagsFromQuery(result: { state: string; data?: Record<string, unknown> }): RegFlags {
  const d = result.data ?? {};
  return {
    isInitialised: result.state === "exists" && Boolean(d.isInitialised),
    hasX25519: Boolean(d.isUserAccountX25519KeyRegistered),
    hasCommitment: Boolean(d.isUserCommitmentRegistered),
  };
}

function fullyRegistered(f: RegFlags): boolean {
  return f.isInitialised && f.hasX25519 && f.hasCommitment;
}

function describeMissing(f: RegFlags): string {
  const missing: string[] = [];
  if (!f.isInitialised) missing.push("account init");
  if (!f.hasX25519) missing.push("X25519 key registration");
  if (!f.hasCommitment) missing.push("user commitment registration");
  return missing.join(", ");
}

export function RegistrationGate({ children }: { children: ReactNode }) {
  const { client, selectedAccount } = useUmbraSession();
  const [state, setState] = useState<State>("loading");
  const [flags, setFlags] = useState<RegFlags | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (!client || !selectedAccount) {
      setState("loading");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const querier = getUserAccountQuerierFunction({ client });
        const result = await querier(selectedAccount.address as never);
        if (cancelled) return;
        const f = flagsFromQuery(result as never);
        setFlags(f);
        setState(fullyRegistered(f) ? "registered" : "needs-registration");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedAccount]);

  async function register() {
    if (!client || !selectedAccount) return;
    setRegistering(true);
    setError(null);
    try {
      const fn = getUserRegistrationFunction(
        { client },
        { zkProver: registrationProver },
      );
      const signatures = (await fn({ confidential: true, anonymous: true })) as readonly unknown[];

      // Diagnostic: register() may return 0 signatures if all sub-steps
      // were already complete on-chain, OR (silently) if the SDK's
      // master-seed derivation mismatched and it skipped everything.
      // We log so a no-op popup with no signal is debuggable.
      console.info(
        `[Umbra] register({confidential, anonymous}) returned ${signatures.length} signature(s):`,
        signatures,
      );

      // Re-query to confirm ALL three flags actually landed. The SDK's
      // register() returns Signature[] of length 0–3 and skips
      // already-complete steps; we never trust the call alone.
      const querier = getUserAccountQuerierFunction({ client });
      const after = await querier(selectedAccount.address as never);
      const f = flagsFromQuery(after as never);
      setFlags(f);
      if (fullyRegistered(f)) {
        setState("registered");
      } else {
        const noSigsHint =
          signatures.length === 0
            ? " (register() returned 0 signatures — possible derivation mismatch or stale on-chain state)"
            : "";
        setError(
          `Registration incomplete — still missing: ${describeMissing(f)}. Click Register again.${noSigsHint}`,
        );
        setState("needs-registration");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  if (!client || !selectedAccount) {
    return <p className="muted">Connect a wallet to continue.</p>;
  }
  if (state === "loading") return <p className="muted">Checking registration…</p>;
  if (state === "error") return <p className="error">{error}</p>;
  if (state === "needs-registration") {
    return (
      <div className="card">
        <h2>Register on Umbra</h2>
        <p>
          One-time setup. Three sub-steps: account init, X25519 key registration,
          user commitment registration. The SDK runs all three and skips any already
          complete — you may see up to three transaction prompts.
        </p>
        {flags && (
          <ul className="muted">
            <li>{flags.isInitialised ? "✓" : "◯"} Account init</li>
            <li>{flags.hasX25519 ? "✓" : "◯"} X25519 key registration</li>
            <li>{flags.hasCommitment ? "✓" : "◯"} User commitment registration</li>
          </ul>
        )}
        <button onClick={() => void register()} disabled={registering}>
          {registering ? "Registering…" : "Register"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  return <>{children}</>;
}
