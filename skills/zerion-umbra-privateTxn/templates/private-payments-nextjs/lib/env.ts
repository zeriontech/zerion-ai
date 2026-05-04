import { z } from "zod";

// UTXO indexer + relayer URLs are absolute upstream URLs — the browser
// calls them directly (CORS-allowed Umbra services).
//
// The data-indexer URL is a RELATIVE proxy path (`/proxy/data-indexer`)
// — same-origin to keep the upstream host out of the browser bundle.
// The actual upstream lives in the server-only `DATA_INDEXER_UPSTREAM`
// env var (see next.config.ts).
const schema = z.object({
  NEXT_PUBLIC_NETWORK: z.enum(["mainnet-beta", "devnet", "localnet"]),
  NEXT_PUBLIC_RPC_URL: z.string().url(),
  NEXT_PUBLIC_RPC_WS_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  NEXT_PUBLIC_DEFAULT_MINT: z.string().min(32).max(44),
  NEXT_PUBLIC_INDEXER_URL: z.string().url(),
  NEXT_PUBLIC_RELAYER_URL: z.string().url(),
  NEXT_PUBLIC_DATA_INDEXER_URL: z.string().min(1),
});

const raw = {
  NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_RPC_WS_URL: process.env.NEXT_PUBLIC_RPC_WS_URL,
  NEXT_PUBLIC_DEFAULT_MINT: process.env.NEXT_PUBLIC_DEFAULT_MINT,
  NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL,
  NEXT_PUBLIC_RELAYER_URL: process.env.NEXT_PUBLIC_RELAYER_URL,
  NEXT_PUBLIC_DATA_INDEXER_URL: process.env.NEXT_PUBLIC_DATA_INDEXER_URL,
};

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(
    `Invalid environment configuration. Copy .env.example to .env.local and set:\n${issues}`,
  );
}

export const env = parsed.data;

export function deriveWsUrl(): string {
  if (env.NEXT_PUBLIC_RPC_WS_URL) return env.NEXT_PUBLIC_RPC_WS_URL;
  return env.NEXT_PUBLIC_RPC_URL.replace(/^http/, "ws");
}

export type Network = "mainnet" | "devnet" | "localnet";

export function umbraNetwork(): Network {
  if (env.NEXT_PUBLIC_NETWORK === "mainnet-beta") return "mainnet";
  if (env.NEXT_PUBLIC_NETWORK === "devnet") return "devnet";
  return "localnet";
}
