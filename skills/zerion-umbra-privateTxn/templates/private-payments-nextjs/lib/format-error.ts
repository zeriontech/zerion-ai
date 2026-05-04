// Surface the actual on-chain reason from any shape Solana / Umbra
// errors arrive in. Without this, every simulation failure looks
// identical ("Failed to send transaction"). Critical for diagnosing
// 3012 (AccountNotInitialized → mint pool not deployed; pitfalls.md §13),
// custom program errors, ZK proof rejections, and Arcium MPC failures.

interface MaybeWithLogs {
  logs?: readonly string[];
  transactionLogs?: readonly string[];
  cause?: unknown;
  context?: { logs?: readonly string[] };
  data?: { logs?: readonly string[] };
  message?: string;
}

function extractLogs(err: unknown, depth = 0): readonly string[] {
  if (depth > 5 || !err || typeof err !== "object") return [];
  const e = err as MaybeWithLogs;
  if (Array.isArray(e.logs)) return e.logs;
  if (Array.isArray(e.transactionLogs)) return e.transactionLogs;
  if (Array.isArray(e.context?.logs)) return e.context.logs;
  if (Array.isArray(e.data?.logs)) return e.data.logs;
  if (e.cause) return extractLogs(e.cause, depth + 1);
  return [];
}

function extractAnchorErrorCode(logs: readonly string[]): number | null {
  for (const line of logs) {
    const m = line.match(/Error Number:\s*(\d+)/) ?? line.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
    if (m && m[1]) {
      const n = m[0].includes("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

const ANCHOR_HINTS: Record<number, string> = {
  3012: "AccountNotInitialized: the protocol pool / fee_schedule for this mint isn't deployed on this cluster. Pick a different mint or check pitfalls.md §13.",
  3010: "AccountNotInitialized (legacy code) — same diagnosis as 3012.",
  3014: "AccountOwnedByWrongProgram: a PDA you derived points at the wrong program. Check the network arg matches your RPC cluster.",
};

export interface FormattedSdkError {
  message: string;
  anchorCode: number | null;
  hint: string | null;
  logs: readonly string[];
}

export function formatSdkError(err: unknown): FormattedSdkError {
  const baseMessage = err instanceof Error ? err.message : String(err);
  const logs = extractLogs(err);
  const anchorCode = extractAnchorErrorCode(logs);
  const hint = anchorCode !== null ? (ANCHOR_HINTS[anchorCode] ?? null) : null;
  return {
    message: baseMessage,
    anchorCode,
    hint,
    logs,
  };
}

export function formatSdkErrorString(err: unknown): string {
  const f = formatSdkError(err);
  const parts = [f.message];
  if (f.anchorCode !== null) parts.push(`Anchor code: ${f.anchorCode}`);
  if (f.hint) parts.push(`Hint: ${f.hint}`);
  if (f.logs.length > 0) parts.push("Program logs:\n  " + f.logs.join("\n  "));
  return parts.join("\n");
}
