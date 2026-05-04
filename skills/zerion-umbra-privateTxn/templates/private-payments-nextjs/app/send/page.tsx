"use client";

// Send flow with recipient-registration pre-check (pitfalls.md §14).
//
// Decision tree on submit:
//   1. Recipient is fully registered on Umbra → use receiver-claimable
//      (Tier 2 at deposit, Tier 1 once recipient claims).
//   2. Recipient is NOT fully registered → block with a clear error AND
//      offer a one-click fallback to a self-claimable UTXO.
//
// Self-claimable shifts the unlocker to the SENDER (no recipient
// account required). The sender must hand the recipient a regeneration
// secret out-of-band, OR claim themselves and forward via a normal
// transfer. We only offer this fallback when the recipient is reachable
// and explicitly chose to proceed without registering them first.
//
// Critical rules:
//   - 1: do NOT pass generationIndex. Auto-derive.
//   - 9: validate the mint is supported (and pool is deployed — §13).
//   - 5: optionalData (if present) MUST be 32 bytes pre-hashed.
//   - 14: pre-check recipient registration; fall back if missing.

import Link from "next/link";
import { useState } from "react";
import {
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToSelfClaimableUtxoCreatorFunction,
} from "@umbra-privacy/sdk";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { PrivacyTierBadge } from "@/components/PrivacyTierBadge";
import { useUmbraSession } from "@/app/providers";
import { env } from "@/lib/env";
import { isSupportedMint, findMint } from "@/lib/supported-mints";
import {
  createReceiverFromPublicProver,
  // claimable-utxo provers from web-zk-prover; the self-from-public
  // prover is wired in zk-prover.ts.
} from "@/lib/zk-prover";
import { formatSdkErrorString } from "@/lib/format-error";
import {
  checkRecipientRegistration,
  describeMissing,
  type RegistrationStatus,
} from "@/lib/recipient-registration-check";

type Mode = "auto" | "force-self";

export default function SendPage() {
  const { client, selectedAccount } = useUmbraSession();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState(env.NEXT_PUBLIC_DEFAULT_MINT);
  const [submitting, setSubmitting] = useState(false);
  const [signatures, setSignatures] = useState<readonly { label: string; sig: string }[] | null>(null);
  const [variantUsed, setVariantUsed] = useState<"receiver" | "self" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientStatus, setRecipientStatus] = useState<RegistrationStatus | null>(null);

  async function send(mode: Mode = "auto") {
    if (!client || !selectedAccount) return;
    setError(null);
    setSignatures(null);
    setRecipientStatus(null);
    setVariantUsed(null);

    // Mint + pool validation
    if (!isSupportedMint(mint, env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet")) {
      setError(`Mint ${mint} is not on the Umbra supported-tokens list for ${env.NEXT_PUBLIC_NETWORK}.`);
      return;
    }
    const meta = findMint(mint, env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet");
    if (!meta) return;

    // Same-wallet round-trip block (privacy.md anti-pattern §1)
    if (recipient === selectedAccount.address) {
      setError(
        "Refusing to send to your own wallet — same-wallet round-trip eliminates all privacy.",
      );
      return;
    }

    // Amount parsing
    let amountRaw: bigint;
    try {
      const [wholeStr, fracStr = ""] = amount.split(".");
      const whole = wholeStr ?? "0";
      const padded = (fracStr + "0".repeat(meta.decimals)).slice(0, meta.decimals) || "0";
      amountRaw = BigInt(whole) * BigInt(10) ** BigInt(meta.decimals) + BigInt(padded);
    } catch {
      setError("Invalid amount.");
      return;
    }
    if (amountRaw <= 0n) {
      setError("Amount must be positive.");
      return;
    }

    setSubmitting(true);
    try {
      // Pre-check recipient registration (pitfalls.md §14).
      // Skip the check if mode === "force-self" — the sender already
      // chose the fallback path.
      let useReceiverVariant = mode === "auto";
      if (mode === "auto") {
        const status = await checkRecipientRegistration(client, recipient);
        setRecipientStatus(status);
        if (!status.fullyRegistered) {
          setError(
            `Recipient is not fully registered on Umbra (missing: ${describeMissing(status)}). ` +
              `Either ask them to register first, or click "Send as self-claimable" below to ` +
              `proceed without recipient registration. Self-claimable transfers shift unlocking ` +
              `responsibility back to you — see privacy notes.`,
          );
          setSubmitting(false);
          return;
        }
      }

      let result: {
        closeProofAccountSignature?: unknown;
        createProofAccountSignature: unknown;
        createUtxoSignature: unknown;
      };

      if (useReceiverVariant) {
        const create = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client },
          { zkProver: createReceiverFromPublicProver },
        );
        result = await create({
          amount: amountRaw as never,
          destinationAddress: recipient as never,
          mint: mint as never,
        });
        setVariantUsed("receiver");
      } else {
        // Fallback: self-claimable. The lazy import keeps the receiver
        // case from pulling in this prover at first paint.
        const { createSelfFromPublicProver } = await import("@/lib/zk-prover");
        const create = getPublicBalanceToSelfClaimableUtxoCreatorFunction(
          { client },
          { zkProver: createSelfFromPublicProver },
        );
        result = await create({
          amount: amountRaw as never,
          destinationAddress: recipient as never,
          mint: mint as never,
        });
        setVariantUsed("self");
      }

      const sigs: { label: string; sig: string }[] = [
        { label: "createUtxo", sig: result.createUtxoSignature as unknown as string },
        { label: "createProofAccount", sig: result.createProofAccountSignature as unknown as string },
      ];
      if (result.closeProofAccountSignature) {
        sigs.unshift({ label: "closeProofAccount", sig: result.closeProofAccountSignature as unknown as string });
      }
      setSignatures(sigs);
    } catch (e: unknown) {
      console.error("Umbra send failed:", formatSdkErrorString(e));
      setError(formatSdkErrorString(e));
    } finally {
      setSubmitting(false);
    }
  }

  const showFallbackButton =
    !!recipientStatus && !recipientStatus.fullyRegistered && !signatures;
  const tier = variantUsed === "self" ? 3 : 2;

  return (
    <>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/account">Account</Link>
        <Link href="/send" className="active">Send</Link>
        <Link href="/receive">Receive</Link>
      </nav>
      <h1>Send <PrivacyTierBadge tier={tier} /></h1>
      <p className="muted">
        Deposit from your ATA into a receiver-claimable UTXO. The recipient claims it into
        their encrypted balance — their identity stays hidden on-chain.
      </p>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <label>Recipient address</label>
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setRecipientStatus(null);
              setError(null);
            }}
            placeholder="Solana address (recipient registration is checked at send time)"
            spellCheck={false}
          />
          <label>Amount</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
          <label>Mint</label>
          <input value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />
          <p className="muted">
            Default: {findMint(mint, env.NEXT_PUBLIC_NETWORK as "mainnet-beta" | "devnet")?.symbol ?? "(unsupported)"}
          </p>
          <button onClick={() => void send("auto")} disabled={submitting || !recipient || !amount}>
            {submitting ? "Sending…" : "Send privately"}
          </button>
          {showFallbackButton && (
            <button
              onClick={() => void send("force-self")}
              disabled={submitting}
              className="secondary"
              style={{ marginLeft: 8 }}
            >
              Send as self-claimable (you remain the unlocker)
            </button>
          )}
          {error && <pre className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</pre>}
          {signatures && (
            <>
              <h2>Sent ({variantUsed === "self" ? "self-claimable" : "receiver-claimable"})</h2>
              {variantUsed === "self" && (
                <p className="muted">
                  ⚠ You are the unlocker. To privacy-protect: delay your claim and avoid
                  burning the nullifier in a predictable timing window. See privacy.md.
                </p>
              )}
              {signatures.map((s) => (
                <p key={s.sig} className="mono">{s.label}: {s.sig}</p>
              ))}
            </>
          )}
        </div>
      </RegistrationGate>
    </>
  );
}
