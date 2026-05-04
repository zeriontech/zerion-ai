"use client";

import { useUmbraSession } from "@/app/providers";

export function WalletButton() {
  const { wallets, selectedWallet, selectedAccount, selectWallet, disconnect, loading, error } =
    useUmbraSession();

  if (selectedWallet && selectedAccount) {
    return (
      <div className="row">
        <span className="mono">
          {selectedWallet.name} · {selectedAccount.address.slice(0, 4)}…{selectedAccount.address.slice(-4)}
        </span>
        <button className="secondary" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="card">
        <p>No Wallet Standard wallets detected. Install Phantom, Backpack, or Solflare.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Connect a wallet</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {wallets.map((w) => (
          <button
            key={w.name}
            disabled={loading}
            onClick={() => void selectWallet(w)}
            className="secondary"
          >
            {w.name}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
