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

export async function getMppFetch(auth) {
  if (_mppFetch) return _mppFetch;
  const { Mppx, tempo } = await import("mppx/client");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(auth.key);
  const mppx = Mppx.create({ methods: [tempo({ account })] });
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
