import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/account">Account</Link>
        <Link href="/send">Send</Link>
        <Link href="/receive">Receive</Link>
      </nav>
      <h1>__APP_NAME__</h1>
      <p>Private payments on Solana, powered by Umbra.</p>
      <div className="card">
        <h2>Get started</h2>
        <ol>
          <li>
            <Link href="/account">Connect your wallet + register on Umbra</Link>
          </li>
          <li>
            <Link href="/send">Send</Link> — deposit + create a receiver-claimable UTXO.
          </li>
          <li>
            <Link href="/receive">Receive</Link> — scan + claim incoming UTXOs.
          </li>
        </ol>
        <p className="muted">
          The first time you connect, you&apos;ll be asked to sign the Umbra magic message — this
          deterministically derives your viewing keys. The signature does NOT authorise any
          spend; it&apos;s read-only.
        </p>
      </div>
    </>
  );
}
