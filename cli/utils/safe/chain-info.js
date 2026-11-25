// safe-client.safe.global answers 403 to scripts, so discovery reads the safe-config service, which serves the same fields.
const SAFE_CONFIG_CHAINS_URL = "https://safe-config.safe.global/api/v1/chains";

function unavailable(chainId, reason) {
  return Object.assign(
    new Error(`Safe chain info for chain ${chainId} is unavailable: ${reason}`),
    { code: "safe_chain_info_unavailable" },
  );
}

export async function getSafeChainInfo(chainId, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${SAFE_CONFIG_CHAINS_URL}/${chainId}/`);
  } catch (err) {
    throw unavailable(chainId, err.message);
  }
  if (res.status === 404) return { txServiceUrl: null, shortName: null };
  if (!res.ok) throw unavailable(chainId, `HTTP ${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw unavailable(chainId, `invalid JSON: ${err.message}`);
  }
  const service = typeof body?.transactionService === "string" && body.transactionService
    ? body.transactionService.replace(/\/$/, "")
    : null;
  return {
    txServiceUrl: service,
    shortName: typeof body?.shortName === "string" && body.shortName ? body.shortName : null,
  };
}
