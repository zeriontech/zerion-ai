// x402 pay-per-call support — lazy-loaded.
// Supports EVM (Base) via @x402/evm and Solana via @x402/svm.
// Key resolution (highest priority first):
//   EVM:    EVM_PRIVATE_KEY  →  WALLET_PRIVATE_KEY (if 0x-prefixed)
//   Solana: SOLANA_PRIVATE_KEY  →  WALLET_PRIVATE_KEY (if base58, 87-88 chars)

let _x402Fetch = null;

// Solana keypairs are 64 bytes; base58-encoded they are 87-88 characters.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
function isEvmKey(k)    { return k.startsWith("0x"); }
function isSolanaKey(k) { return !k.startsWith("0x") && BASE58_RE.test(k) && k.length >= 87; }

function resolveKeys() {
  const wallet = process.env.WALLET_PRIVATE_KEY || "";
  return {
    evm:    process.env.EVM_PRIVATE_KEY    || (isEvmKey(wallet)    ? wallet : ""),
    solana: process.env.SOLANA_PRIVATE_KEY || (isSolanaKey(wallet) ? wallet : ""),
  };
}

function normalizeX402Error(err) {
  const msg = err.message || "";
  if (/insufficient.*balance|not enough.*fund|balance.*too low/i.test(msg)) {
    const e = new Error(
      "Insufficient USDC balance for x402 payment.\n" +
      "Fund your wallet with USDC on Base (EVM) or Solana to continue."
    );
    e.code = "x402_insufficient_funds";
    return e;
  }
  const firstLine = msg.split("\n").find((l) => l.trim()) || msg;
  const e = new Error(`x402 payment failed: ${firstLine.trim()}`);
  e.code = "x402_payment_failed";
  return e;
}

export async function getX402Fetch() {
  if (_x402Fetch) return _x402Fetch;

  const { evm, solana } = resolveKeys();
  if (!evm && !solana) {
    throw new Error(
      "x402 mode requires a private key.\n" +
      "  EVM (Base):  set WALLET_PRIVATE_KEY=0x...  or  EVM_PRIVATE_KEY=0x...\n" +
      "  Solana:      set WALLET_PRIVATE_KEY=<base58>  or  SOLANA_PRIVATE_KEY=<base58>"
    );
  }

  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const client = new x402Client();

  if (evm) {
    const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
    const { privateKeyToAccount } = await import("viem/accounts");
    registerExactEvmScheme(client, { signer: privateKeyToAccount(evm) });
  }

  if (solana) {
    const { registerExactSvmScheme } = await import("@x402/svm/exact/client");
    const { createKeyPairSignerFromBytes, getBase58Codec } = await import("@solana/kit");
    const bytes = getBase58Codec().encode(solana);
    const signer = await createKeyPairSignerFromBytes(bytes);
    registerExactSvmScheme(client, { signer });
  }

  // When both chains are available, optionally prefer Solana by reordering
  // payment requirements so Solana options are evaluated first.
  if (evm && solana && process.env.ZERION_X402_PREFER_SOLANA === "true") {
    client.registerPolicy((_version, reqs) => [
      ...reqs.filter((r) => r.network.startsWith("solana:")),
      ...reqs.filter((r) => !r.network.startsWith("solana:")),
    ]);
  }

  const chains = [evm && "EVM (Base)", solana && "Solana"].filter(Boolean).join(" + ");
  const inner = wrapFetchWithPayment(fetch, client);

  _x402Fetch = async (url, options) => {
    try {
      const response = await inner(url, options);
      process.stderr.write(`  \x1b[2m↳ Paid $0.01 via x402 (${chains})\x1b[0m\n`);
      return response;
    } catch (err) {
      throw normalizeX402Error(err);
    }
  };

  return _x402Fetch;
}

export function isX402Enabled() {
  return process.env.ZERION_X402 === "true";
}
