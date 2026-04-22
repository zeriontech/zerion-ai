// MPP pay-per-call support — lazy-loaded.
// Only imports mppx when actually needed.

let _mppFetch = null;

export async function getMppFetch() {
  if (_mppFetch) return _mppFetch;
  const privateKey = process.env.TEMPO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "TEMPO_PRIVATE_KEY is required for MPP mode. Set it as an environment variable."
    );
  }
  const { Mppx, tempo } = await import("mppx/client");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);
  const mppx = Mppx.create({ methods: [tempo({ account })] });
  _mppFetch = mppx.fetch.bind(mppx);
  return _mppFetch;
}

export function isMppEnabled() {
  return process.env.ZERION_MPP === "true";
}
