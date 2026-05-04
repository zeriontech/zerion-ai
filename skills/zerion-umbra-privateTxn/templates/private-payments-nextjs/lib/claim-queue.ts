// Idempotent claim wrapper. Implements the pitfalls.md §3 pattern:
//
//   1. Verify the nullifier isn't already burnt on-chain BEFORE submitting.
//      If burnt, the claim already landed — skip.
//   2. Submit to the relayer, capture request_id.
//   3. Poll request_id to terminal state (completed | failed | timed_out).
//      DUPLICATE_OFFSET (HTTP 409) is treated as success — the relayer
//      saw a prior request for the same nullifier.
//   4. On non-terminal failure, re-check the on-chain nullifier before
//      retrying. Never blindly resubmit.
//
// Same-wallet round-trip block: refuse to claim into the source ATA
// (privacy.md anti-pattern §1).

import { pollClaimUntilTerminal } from "@umbra-privacy/sdk";
import type { ClaimStatusPollerFunction } from "@umbra-privacy/sdk/interfaces";

export type ClaimTerminalStatus = "completed" | "failed" | "timed_out" | "refunded";

export interface ClaimSubmitResult {
  requestId: string;
}

export interface ClaimRunResult {
  status: ClaimTerminalStatus | "skipped_already_burnt";
  requestId?: string;
}

export interface ClaimQueueArgs {
  sourceAddress: string;
  destinationAddress: string;
  isNullifierBurntOnChain: () => Promise<boolean>;
  submitClaim: () => Promise<ClaimSubmitResult>;
  pollClaimStatus: ClaimStatusPollerFunction;
}

export async function runClaimWithIdempotency(args: ClaimQueueArgs): Promise<ClaimRunResult> {
  if (args.sourceAddress === args.destinationAddress) {
    throw new Error(
      "Refusing to claim back to the source ATA — same-wallet round-trip eliminates all privacy. " +
        "See privacy.md anti-pattern §1.",
    );
  }

  if (await args.isNullifierBurntOnChain()) {
    return { status: "skipped_already_burnt" };
  }

  const { requestId } = await args.submitClaim();
  const result = await pollClaimUntilTerminal(args.pollClaimStatus, requestId);
  const status = result.status as ClaimTerminalStatus;

  if (status === "completed") return { status, requestId };
  if (status === "failed" || status === "timed_out" || status === "refunded") {
    if (await args.isNullifierBurntOnChain()) {
      return { status: "completed", requestId };
    }
    return { status, requestId };
  }
  return { status, requestId };
}
