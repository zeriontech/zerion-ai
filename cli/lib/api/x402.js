/**
 * x402 pay-per-call support — lazy-loaded.
 * Only imports @x402/fetch and @x402/evm when actually needed.
 */

let _x402Fetch = null;

export async function getX402Fetch() {
  if (_x402Fetch) return _x402Fetch;
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY || "";
  if (!walletPrivateKey) {
    throw new Error(
      "WALLET_PRIVATE_KEY is required for x402 mode. Set it as an environment variable."
    );
  }
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
  const { privateKeyToAccount } = await import("viem/accounts");
  const signer = privateKeyToAccount(walletPrivateKey);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  _x402Fetch = wrapFetchWithPayment(fetch, client);
  return _x402Fetch;
}

export function isX402Enabled() {
  return process.env.ZERION_X402 === "true";
}
