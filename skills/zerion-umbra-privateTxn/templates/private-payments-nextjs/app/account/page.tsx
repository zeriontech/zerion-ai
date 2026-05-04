"use client";

import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";
import { RegistrationGate } from "@/components/RegistrationGate";
import { useUmbraSession } from "@/app/providers";

export default function AccountPage() {
  const { selectedAccount } = useUmbraSession();
  return (
    <>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/account" className="active">Account</Link>
        <Link href="/send">Send</Link>
        <Link href="/receive">Receive</Link>
      </nav>
      <h1>Account</h1>
      <WalletButton />
      <RegistrationGate>
        <div className="card">
          <h2>Registered</h2>
          <p>You&apos;re ready to send and receive.</p>
          <p className="mono">{selectedAccount?.address}</p>
          <div className="row">
            <Link href="/send">Go to Send →</Link>
            <Link href="/receive">Go to Receive →</Link>
          </div>
        </div>
      </RegistrationGate>
    </>
  );
}
