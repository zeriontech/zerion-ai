import { getSafeApiKey } from "../config.js";

const BODY_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const ALREADY_EXISTS = /already exists/i;
export const QUEUE_PAGE_LIMIT = 100;

function safeTxServiceError(status, body) {
  const err = new Error(
    status == null
      ? "Safe Transaction Service request failed"
      : `Safe Transaction Service error: ${status}`
  );
  err.code = "safe_tx_service_error";
  err.status = status;
  err.body = body;
  return err;
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 501);
}

export function requireSafeApiKey({ txServiceUrl }) {
  if (!txServiceUrl) return null;
  const key = getSafeApiKey();
  if (!key) {
    const err = new Error("A Safe Transaction Service API key is required for this chain");
    err.code = "safe_api_key_missing";
    err.suggestion = "Set one: zerion config set safeApiKey <key>  (or export SAFE_API_KEY=<key>)";
    throw err;
  }
  return key;
}

export function createTxServiceClient({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 5,
}) {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const failure = (status, text) => {
    const redacted = apiKey ? String(text).split(apiKey).join("***") : String(text);
    return safeTxServiceError(status, redacted.slice(0, BODY_LIMIT));
  };

  async function request(method, path, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (networkErr) {
      return { status: null, text: networkErr?.message ?? String(networkErr) };
    }
    return { status: response.status, text: await response.text() };
  }

  async function getJson(path, { notFoundAsNull = false } = {}) {
    const { status, text } = await request("GET", path);
    if (notFoundAsNull && status === 404) return null;
    if (status === null || status < 200 || status >= 300) throw failure(status, text);
    try {
      return JSON.parse(text);
    } catch {
      throw failure(status, text);
    }
  }

  function getTransaction(safeTxHash) {
    return getJson(`/api/v1/multisig-transactions/${safeTxHash}/`, { notFoundAsNull: true });
  }

  async function listQueued(safeAddress, { nonceGte = 0 } = {}) {
    const json = await getJson(
      `/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false&nonce__gte=${nonceGte}&ordering=nonce&limit=${QUEUE_PAGE_LIMIT}`
    );
    return (json?.results ?? []).map((tx) => ({
      safeTxHash: tx.safeTxHash,
      nonce: Number(tx.nonce),
      to: tx.to,
      value: String(tx.value),
      data: tx.data ?? null,
      operation: Number(tx.operation),
      confirmations: Array.isArray(tx.confirmations) ? tx.confirmations.length : 0,
      confirmationsRequired: Number(tx.confirmationsRequired),
    }));
  }

  async function existsAfterFailure(safeTxHash) {
    try {
      return (await getTransaction(safeTxHash)) !== null;
    } catch {
      return false;
    }
  }

  async function propose({ safeAddress, message, safeTxHash, sender, signature, origin = "zerion-cli" }) {
    const body = {
      to: message.to,
      value: String(message.value),
      data: message.data,
      operation: Number(message.operation),
      safeTxGas: String(message.safeTxGas),
      baseGas: String(message.baseGas),
      gasPrice: String(message.gasPrice),
      gasToken: message.gasToken,
      refundReceiver: message.refundReceiver,
      nonce: Number(message.nonce),
      contractTransactionHash: safeTxHash,
      sender,
      signature,
      origin,
    };
    const path = `/api/v1/safes/${safeAddress}/multisig-transactions/`;

    for (let attempt = 1; ; attempt += 1) {
      const { status, text } = await request("POST", path, body);
      if (status !== null && status >= 200 && status < 300) return { status: "created" };
      if ((status === 400 || status === 422) && ALREADY_EXISTS.test(text)) return { status: "exists" };
      if (status !== null && !isRetryable(status)) throw failure(status, text);
      if (attempt >= maxAttempts) throw failure(status, text);
      await sleep(backoffMs(attempt));
      if (await existsAfterFailure(safeTxHash)) return { status: "exists" };
    }
  }

  return { getTransaction, listQueued, propose };
}
