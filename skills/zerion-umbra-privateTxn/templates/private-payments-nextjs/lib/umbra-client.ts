// Thin wrapper around getUmbraClient. The client is keyed by signer
// address — the React provider in app/providers.tsx invalidates this
// when the connected wallet changes (see pitfalls.md §7c — wallet-change
// client invalidation).
//
// Master-seed storage default: re-derive every session via
// signer.signMessage(UMBRA_MESSAGE_TO_SIGN). Zero persistence, zero
// attack surface. To skip the per-session signature, supply a
// `masterSeedStorage.load`/`store` override here. Read pitfalls.md §7
// before doing so.

import { getUmbraClient } from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import { env, deriveWsUrl, umbraNetwork } from "./env";
import { umbraSignerFromWallet } from "./signer";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

const cache = new Map<string, Promise<IUmbraClient>>();

export async function getOrCreateUmbraClient(
  wallet: Wallet,
  account: WalletAccount,
): Promise<IUmbraClient> {
  const key = account.address;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const signer = umbraSignerFromWallet(wallet, account);
    return getUmbraClient({
      signer,
      network: umbraNetwork(),
      rpcUrl: env.NEXT_PUBLIC_RPC_URL,
      rpcSubscriptionsUrl: deriveWsUrl(),
      indexerApiEndpoint: env.NEXT_PUBLIC_INDEXER_URL,
    });
  })();

  cache.set(key, promise);
  return promise;
}

export function invalidateUmbraClient(address: string): void {
  cache.delete(address);
}

export function clearUmbraClientCache(): void {
  cache.clear();
}
