// Adapt a connected Wallet Standard wallet to an IUmbraSigner.
// The SDK exports `createSignerFromWalletAccount(wallet, account)` —
// it requires the wallet to support `solana:signTransaction` AND
// `solana:signMessage` features. See SKILL.md "Signer factories".

import { createSignerFromWalletAccount } from "@umbra-privacy/sdk";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export function umbraSignerFromWallet(wallet: Wallet, account: WalletAccount) {
  if (!wallet.features["solana:signTransaction"]) {
    throw new Error(`Wallet "${wallet.name}" does not support solana:signTransaction.`);
  }
  if (!wallet.features["solana:signMessage"]) {
    throw new Error(`Wallet "${wallet.name}" does not support solana:signMessage.`);
  }
  return createSignerFromWalletAccount(wallet, account);
}
