// Pre-flight: confirm a recipient is registered on Umbra before
// building a receiver-claimable UTXO against their key.
//
// Pitfalls.md §14 — receiver-claimable creates encrypt the unlocker
// against the recipient's `userCommitment`. If the recipient hasn't
// completed all three registration sub-steps, the on-chain program
// rejects the tx with an opaque "Transaction simulation failed".
// Catch this BEFORE building / signing.

import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";

export interface RegistrationStatus {
  fullyRegistered: boolean;
  isInitialised: boolean;
  hasX25519: boolean;
  hasCommitment: boolean;
  missing: readonly string[];
}

const ALL_MISSING: readonly string[] = ["account init", "X25519 key", "user commitment"];

export async function checkRecipientRegistration(
  client: IUmbraClient,
  recipient: string,
): Promise<RegistrationStatus> {
  const querier = getUserAccountQuerierFunction({ client });
  const result = await querier(recipient as never);

  if (result.state !== "exists") {
    return {
      fullyRegistered: false,
      isInitialised: false,
      hasX25519: false,
      hasCommitment: false,
      missing: ALL_MISSING,
    };
  }
  const d = (result.data ?? {}) as unknown as Record<string, unknown>;
  const isInitialised = Boolean(d.isInitialised);
  const hasX25519 = Boolean(d.isUserAccountX25519KeyRegistered);
  const hasCommitment = Boolean(d.isUserCommitmentRegistered);

  const missing: string[] = [];
  if (!isInitialised) missing.push("account init");
  if (!hasX25519) missing.push("X25519 key");
  if (!hasCommitment) missing.push("user commitment");

  return {
    fullyRegistered: missing.length === 0,
    isInitialised,
    hasX25519,
    hasCommitment,
    missing,
  };
}

export function describeMissing(status: RegistrationStatus): string {
  return status.missing.join(", ") || "(none)";
}
