// Production-grade claim service.
//
// Patterns (mirroring frontend-core/src/utxo/services/claim-utxo-service.ts):
//   - Group UTXOs by claim type (receiver vs self).
//   - Receiver: chunk into batches of 4, claim sequentially.
//   - Self: claim one-at-a-time (no batching).
//   - On batch nullifier-burnt failure with multiple UTXOs, fall back to
//     single-UTXO claim per affected UTXO (one bad nullifier shouldn't
//     fail the whole batch).
//   - "NullifierAlreadyBurnt" + single-UTXO batch  =  treat as success
//     ("UTXO already claimed") — idempotent semantics.

import {
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfClaimableUtxoToPublicBalanceClaimerFunction,
  getUmbraRelayer,
} from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import {
  claimReceiverIntoEncryptedProver,
  claimSelfIntoPublicProver,
} from "@/lib/zk-prover";
import { formatSdkErrorString } from "@/lib/format-error";
import { env } from "@/lib/env";

export interface ClaimableUtxo {
  raw: unknown;
  id: string;
  type: "receiver" | "self";
}

export interface ClaimResult {
  utxoId: string;
  success: boolean;
  signature: string;
  error?: string;
}

const CLAIM_BATCH_SIZE = 4;

interface BatchLike {
  status: string;
  txSignature?: string;
  callbackSignature?: string;
  failureReason?: string | null;
  utxoIds?: readonly string[];
}

function isBatchSuccessful(b: BatchLike): boolean {
  return b.status === "completed" || b.status === "callback_received";
}
function batchSignature(b: BatchLike): string {
  return b.callbackSignature ?? b.txSignature ?? "";
}
function batchError(b: BatchLike): string {
  if (b.failureReason?.includes("NullifierAlreadyBurnt")) return "UTXO already claimed";
  return `Claim ${b.status}`;
}

function groupByType(utxos: readonly ClaimableUtxo[]): { receiver: ClaimableUtxo[]; self: ClaimableUtxo[] } {
  const receiver: ClaimableUtxo[] = [];
  const self: ClaimableUtxo[] = [];
  for (const u of utxos) {
    (u.type === "receiver" ? receiver : self).push(u);
  }
  return { receiver, self };
}

function relayer() {
  return getUmbraRelayer({ apiEndpoint: env.NEXT_PUBLIC_RELAYER_URL });
}

async function claimReceiverChunk(
  client: IUmbraClient,
  chunk: readonly ClaimableUtxo[],
): Promise<ClaimResult[]> {
  if (!client.fetchBatchMerkleProof) {
    throw new Error("client.fetchBatchMerkleProof unavailable — set NEXT_PUBLIC_INDEXER_URL");
  }
  const r = relayer();
  const claim = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
    { client },
    {
      fetchBatchMerkleProof: client.fetchBatchMerkleProof,
      zkProver: claimReceiverIntoEncryptedProver,
      relayer: {
        submitClaim: r.submitClaim,
        pollClaimStatus: r.pollClaimStatus,
        getRelayerAddress: r.getRelayerAddress,
      },
    },
  );

  const results: ClaimResult[] = [];
  try {
    const out = await claim(chunk.map((u) => u.raw) as never);
    for (const [, b] of out.batches) {
      const batch = b as unknown as BatchLike;
      const ids = batch.utxoIds ?? [];
      if (isBatchSuccessful(batch)) {
        const sig = batchSignature(batch);
        for (const id of ids) results.push({ utxoId: id, success: true, signature: sig });
        continue;
      }
      const isBurnt = batch.failureReason?.includes("NullifierAlreadyBurnt") ?? false;
      if (isBurnt && ids.length === 1) {
        results.push({ utxoId: ids[0]!, success: true, signature: "", error: "UTXO already claimed" });
        continue;
      }
      if (isBurnt) {
        // One bad nullifier in a batch — break it down and retry each individually.
        for (const id of ids) {
          const u = chunk.find((c) => c.id === id);
          if (!u) continue;
          results.push(await claimSingle(client, u));
        }
        continue;
      }
      const err = batchError(batch);
      for (const id of ids) results.push({ utxoId: id, success: false, signature: "", error: err });
    }
  } catch (e) {
    const msg = formatSdkErrorString(e);
    for (const u of chunk) results.push({ utxoId: u.id, success: false, signature: "", error: msg });
  }
  return results;
}

async function claimSelfOne(
  client: IUmbraClient,
  utxo: ClaimableUtxo,
): Promise<ClaimResult> {
  if (!client.fetchBatchMerkleProof) {
    return { utxoId: utxo.id, success: false, signature: "", error: "client.fetchBatchMerkleProof unavailable" };
  }
  const r = relayer();
  const claim = getSelfClaimableUtxoToPublicBalanceClaimerFunction(
    { client },
    {
      fetchBatchMerkleProof: client.fetchBatchMerkleProof,
      zkProver: claimSelfIntoPublicProver,
      relayer: {
        submitClaim: r.submitClaim,
        pollClaimStatus: r.pollClaimStatus,
        getRelayerAddress: r.getRelayerAddress,
      },
    },
  );
  try {
    const out = await claim([utxo.raw] as never);
    const batch = out.batches.values().next().value as BatchLike | undefined;
    if (batch && isBatchSuccessful(batch)) {
      return { utxoId: utxo.id, success: true, signature: batchSignature(batch) };
    }
    if (batch?.failureReason?.includes("NullifierAlreadyBurnt")) {
      return { utxoId: utxo.id, success: true, signature: "", error: "UTXO already claimed" };
    }
    return {
      utxoId: utxo.id,
      success: false,
      signature: "",
      error: batch ? batchError(batch) : "No batch result returned",
    };
  } catch (e) {
    return { utxoId: utxo.id, success: false, signature: "", error: formatSdkErrorString(e) };
  }
}

export async function claimSingle(client: IUmbraClient, utxo: ClaimableUtxo): Promise<ClaimResult> {
  return utxo.type === "receiver"
    ? (await claimReceiverChunk(client, [utxo]))[0]!
    : await claimSelfOne(client, utxo);
}

export async function claimBatch(
  client: IUmbraClient,
  utxos: readonly ClaimableUtxo[],
): Promise<ClaimResult[]> {
  if (utxos.length === 0) return [];
  const { receiver, self } = groupByType(utxos);

  const receiverResults: ClaimResult[] = [];
  for (let i = 0; i < receiver.length; i += CLAIM_BATCH_SIZE) {
    const chunk = receiver.slice(i, i + CLAIM_BATCH_SIZE);
    receiverResults.push(...(await claimReceiverChunk(client, chunk)));
  }

  const selfResults: ClaimResult[] = [];
  for (const u of self) {
    selfResults.push(await claimSelfOne(client, u));
  }

  return [...receiverResults, ...selfResults];
}
