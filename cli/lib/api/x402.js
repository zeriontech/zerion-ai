// x402 pay-per-call support — lazy-loaded.
// Supports EVM (Base) via @x402/evm and Solana via @x402/svm.
// Keys + preferences are resolved by ./auth.js; this module only consumes
// them and builds the fetch wrapper.

let _x402Fetch = null;

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

export async function getX402Fetch(auth) {
  if (_x402Fetch) return _x402Fetch;

  const { evm, solana } = auth.keys;
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
  if (evm && solana && auth.preferSolana) {
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
