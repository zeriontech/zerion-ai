"use client";

// UmbraSessionProvider owns:
//   - the list of registered Wallet Standard wallets,
//   - the currently selected wallet + account,
//   - the UmbraClient instance keyed on the selected account address.
//
// pitfalls.md §7c: switching wallets MUST invalidate the previous
// client. We do that by re-running getOrCreateUmbraClient with the new
// account; the previous client is left to be garbage-collected.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import {
  getOrCreateUmbraClient,
  invalidateUmbraClient,
} from "@/lib/umbra-client";
import { env } from "@/lib/env";

interface SessionState {
  wallets: readonly Wallet[];
  selectedWallet: Wallet | null;
  selectedAccount: WalletAccount | null;
  client: IUmbraClient | null;
  loading: boolean;
  error: string | null;
  selectWallet: (w: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function useUmbraSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUmbraSession must be used inside UmbraSessionProvider");
  return ctx;
}

// Wallet Standard chain identifiers: "solana:mainnet", "solana:devnet",
// "solana:testnet", "solana:localnet". A wallet account that's currently
// in mainnet mode will NOT include "solana:devnet" in its chains array
// (and vice-versa), so we can rely on chain membership to refuse a
// network-mismatched account at connect time.
function expectedSolanaChain(network: string): `${string}:${string}` {
  if (network === "mainnet-beta") return "solana:mainnet";
  return `solana:${network}` as `${string}:${string}`;
}

function pickSolanaAccount(
  accounts: readonly WalletAccount[],
  network: string,
): { account: WalletAccount } | { error: string } {
  const wanted = expectedSolanaChain(network);
  const match = accounts.find((a) => a.chains.includes(wanted));
  if (match) return { account: match };
  const anySolana = accounts.find((a) =>
    a.chains.some((c) => c.startsWith("solana:")),
  );
  if (anySolana) {
    const have = anySolana.chains.filter((c) => c.startsWith("solana:")).join(", ");
    return {
      error: `Wallet is on ${have || "unknown solana cluster"}, but this app is configured for ${wanted}. Switch your wallet's network and reconnect.`,
    };
  }
  return { error: `Wallet did not return a Solana account.` };
}

export function UmbraSessionProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<WalletAccount | null>(null);
  const [client, setClient] = useState<IUmbraClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = getWallets();
    // Wallet Standard occasionally registers the same wallet twice (e.g.
    // a wallet that supports both legacy + standard injection paths).
    // Dedupe by name so the connect UI doesn't render duplicates and
    // React doesn't warn about duplicate keys.
    const dedupe = (ws: readonly Wallet[]): readonly Wallet[] => {
      const seen = new Map<string, Wallet>();
      for (const w of ws) if (!seen.has(w.name)) seen.set(w.name, w);
      return [...seen.values()];
    };
    setWallets(dedupe(api.get()));
    const offRegister = api.on("register", () => setWallets(dedupe(api.get())));
    const offUnregister = api.on("unregister", () => setWallets(dedupe(api.get())));
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  useEffect(() => {
    if (!selectedWallet || !selectedAccount) {
      setClient(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOrCreateUmbraClient(selectedWallet, selectedAccount)
      .then((c) => {
        if (!cancelled) setClient(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWallet, selectedAccount]);

  const selectWallet = useCallback(async (wallet: Wallet) => {
    setError(null);
    setLoading(true);
    try {
      const connectFeature = wallet.features["standard:connect"];
      if (!connectFeature) {
        throw new Error(`Wallet "${wallet.name}" does not support standard:connect.`);
      }
      const result = await (connectFeature as { connect: () => Promise<{ accounts: readonly WalletAccount[] }> }).connect();
      const picked = pickSolanaAccount(result.accounts, env.NEXT_PUBLIC_NETWORK);
      if ("error" in picked) {
        throw new Error(`Wallet "${wallet.name}": ${picked.error}`);
      }
      setSelectedWallet(wallet);
      setSelectedAccount(picked.account);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (selectedAccount) invalidateUmbraClient(selectedAccount.address);
    setSelectedWallet(null);
    setSelectedAccount(null);
    setClient(null);
  }, [selectedAccount]);

  const value = useMemo<SessionState>(
    () => ({
      wallets,
      selectedWallet,
      selectedAccount,
      client,
      loading,
      error,
      selectWallet,
      disconnect,
    }),
    [wallets, selectedWallet, selectedAccount, client, loading, error, selectWallet, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
