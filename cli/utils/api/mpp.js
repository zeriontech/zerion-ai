// MPP pay-per-call support — lazy-loaded.
// Key is resolved by ./auth.js; this module only consumes it.

let _mppFetch = null;

function normalizeMppError(err, address) {
  const msg = err.message || "";
  const m = msg.match(/available:\s*(\d+)[^}]*required:\s*(\d+)/);
  if (m) {
    const have = (Number(m[1]) / 1e6).toFixed(2);
    const need = (Number(m[2]) / 1e6).toFixed(2);
    const e = new Error(
      `Insufficient USDC on Tempo: have $${have}, need $${need}.\n` +
      `Fund ${address} with USDC on Tempo to continue.`
    );
    e.code = "mpp_insufficient_funds";
    return e;
  }
  const firstLine = msg.split("\n").find((l) => l.trim()) || msg;
  const e = new Error(`MPP payment failed: ${firstLine.trim()}`);
  e.code = "mpp_payment_failed";
  return e;
}

// Zerion answers a 402 with two offers side by side: the MPP/Tempo challenge in
// `WWW-Authenticate` and an x402 offer in `PAYMENT-REQUIRED`. Since mppx 0.6.x
// the client parses *both* on every 402, and its x402 schema only accepts EVM
// CAIP-2 networks (`^eip155:\d+$`). Our x402 offer also advertises Solana, so
// that parse throws `Invalid base64 JSON header` — and it throws before the
// perfectly valid Tempo challenge beside it is ever considered, taking `--mpp`
// down with it (WLT-2024). Upgrading doesn't help: 0.8.x rejects it too.
//
// So hide the x402 offer from mppx. In `--mpp` mode the Tempo challenge is the
// one we want, and `--x402` mode goes through @x402/* instead — mppx never has
// a reason to read this header.
function stripX402Offer(baseFetch) {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 402 || !response.headers.has("payment-required")) return response;
    const headers = new Headers(response.headers);
    headers.delete("payment-required");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export async function getMppFetch(auth) {
  if (_mppFetch) return _mppFetch;
  const { Mppx, tempo } = await import("mppx/client");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(auth.key);
  // Capture `fetch` *before* Mppx.create: it defaults to `polyfill: true` and
  // swaps `globalThis.fetch` for its own 402 handler, so a wrapper that called
  // bare `fetch()` would hit mppx's parser — and the bug above — first.
  const baseFetch = globalThis.fetch;
  const mppx = Mppx.create({
    methods: [tempo({ account })],
    fetch: stripX402Offer(baseFetch),
  });
  const inner = mppx.fetch.bind(mppx);

  _mppFetch = async (url, options) => {
    try {
      const response = await inner(url, options);
      process.stderr.write("  \x1b[2m↳ Paid $0.01 via MPP (Tempo)\x1b[0m\n");
      return response;
    } catch (err) {
      throw normalizeMppError(err, account.address);
    }
  };

  return _mppFetch;
}
