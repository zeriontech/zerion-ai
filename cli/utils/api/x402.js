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

// A receipt is the ideal source for *why* settlement failed, but Zerion reports
// a rejected authorization as a plain 402 carrying a JSON:API error and no
// receipt at all — so fall back to the body rather than throwing a bare "not
// settled". Consuming the body is safe here: this path always throws, so the
// response is discarded either way.
async function readFailureReason(response, receipt) {
  const fromReceipt = [receipt?.errorReason, receipt?.errorMessage].filter(Boolean).join(": ");
  if (fromReceipt) return fromReceipt;
  try {
    const payload = JSON.parse(await response.text());
    const apiErr = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    return apiErr?.detail || apiErr?.title || "";
  } catch {
    return "";
  }
}

function settlementFailedError(reason) {
  const e = new Error(
    `x402 payment was not settled${reason ? ` — ${reason}` : ""}.\n` +
    "The authorization was signed but the server did not settle it, so no funds were transferred."
  );
  e.code = "x402_settlement_failed";
  return e;
}

// The settlement receipt: x402 v2 header first, then the v1 alias.
const RECEIPT_HEADERS = ["payment-response", "x-payment-response"];

function readReceipt(response, decode) {
  for (const name of RECEIPT_HEADERS) {
    const raw = response.headers.get(name);
    if (!raw) continue;
    try {
      return decode(raw);
    } catch {
      // A receipt we can't decode tells us nothing either way — try the other
      // header, then fall back to the HTTP status.
    }
  }
  return null;
}

// The signed authorization the client attached to the paid retry — same header
// pair as the receipt, v2 then the v1 alias. Its `accepted` block is the
// payment requirement the client actually chose, so it names the price and
// network even when the server's receipt doesn't.
const AUTHORIZATION_HEADERS = ["payment-signature", "x-payment"];

function readAuthorization(request) {
  for (const name of AUTHORIZATION_HEADERS) {
    const raw = request?.headers?.get?.(name);
    if (!raw) continue;
    try {
      // Base64 JSON, per x402's header codec — decoded by hand so this module
      // keeps its imports to the packages we actually depend on.
      return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"))?.accepted || null;
    } catch {
      // Same as an undecodable receipt: try the alias, then go without.
    }
  }
  return null;
}

// x402's `exact` scheme settles in USDC, 6-decimal on every network Zerion
// advertises — the same conversion normalizeMppError already does by hand.
const USDC_DECIMALS = 6;

function formatAmount(atomic) {
  if (atomic === undefined || atomic === null || atomic === "") return null;
  const n = Number(atomic);
  if (!Number.isFinite(n)) return null;
  const usd = n / 10 ** USDC_DECIMALS;
  // Cents for ordinary prices; a sub-cent charge keeps its significant digits
  // instead of rounding down to "$0.00". A genuine zero is not a sub-cent
  // charge — it reads as "$0.00" like any other round figure.
  return `$${usd > 0 && usd < 0.01 ? String(usd) : usd.toFixed(2)}`;
}

// The receipt names the network that actually settled. `auth.keys` only says
// which signers were *configured*, which is how the old line could claim
// "EVM (Base)" for a payment that went out on Solana.
function formatNetwork(network) {
  if (!network) return null;
  if (network === "eip155:8453") return "EVM (Base)";
  if (network.startsWith("eip155:")) return `EVM (chain ${network.slice("eip155:".length)})`;
  if (network.startsWith("solana:")) return "Solana";
  return network;
}

export async function getX402Fetch(auth) {
  if (_x402Fetch) return _x402Fetch;

  const { evm, solana } = auth.keys;
  const { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } =
    await import("@x402/fetch");
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

  const baseFetch = globalThis.fetch;

  _x402Fetch = async (url, options) => {
    // wrapFetchWithPayment resolves with the post-payment response whether or
    // not it settled, and @x402/core swallows settlement failures rather than
    // throwing — so the old unconditional "Paid" line reported payments that
    // never happened (WLT-2024). Everything below decides that for itself.
    //
    // Note which requests the server actually charged for: a 200 that never
    // saw a 402 cost nothing and must not print a "Paid" line. Grab the signed
    // authorization on the way past too — it's the client's own record of what
    // it agreed to pay. Both are request-local — fetchAPI issues these
    // concurrently — so the (cheap) wrapper is rebuilt per call while the
    // client and its registered schemes stay cached.
    let paymentRequired = false;
    let authorized = null;
    const inner = wrapFetchWithPayment(async (input, init) => {
      authorized = readAuthorization(input) || authorized;
      const response = await baseFetch(input, init);
      if (response.status === 402) paymentRequired = true;
      return response;
    }, client);

    let response;
    try {
      response = await inner(url, options);
    } catch (err) {
      throw normalizeX402Error(err);
    }

    if (!paymentRequired) return response;

    // The receipt is the server's own statement about settlement, so it wins
    // outright when present.
    const receipt = readReceipt(response, decodePaymentResponseHeader);
    if (receipt && receipt.success !== true) {
      throw settlementFailedError(await readFailureReason(response, receipt));
    }

    // Zerion sends no receipt at all — it answers a rejected authorization with
    // a second 402 — so the status has to stand in. It only speaks about the
    // *payment* for that one status, though: a 429, 404 or 5xx on the paid
    // retry is about the request, not the money. Hand those back untouched so
    // fetchAPI's rate-limit retry and JSON:API error reporting keep working,
    // and stay quiet about a payment we can't vouch for either way. A 2xx is
    // the resource being served, which the server wouldn't do unpaid.
    if (!receipt) {
      if (response.status === 402) {
        throw settlementFailedError(await readFailureReason(response, receipt));
      }
      if (!response.ok) return response;
    }

    // Prefer the receipt: it reports what actually settled, which for schemes
    // like `upto` can be less than the authorized maximum. The reference
    // `exact` scheme leaves both fields off, so fall back to the authorization
    // — still the client's own record, not a guess.
    const network = formatNetwork(receipt?.network || authorized?.network);
    const parts = [
      "↳ Paid",
      formatAmount(receipt?.amount ?? authorized?.amount),
      "via x402",
      network && `(${network})`,
    ].filter(Boolean);
    process.stderr.write(`  \x1b[2m${parts.join(" ")}\x1b[0m\n`);
    return response;
  };

  return _x402Fetch;
}
