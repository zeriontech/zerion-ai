// Auth resolution for Zerion API: single source of truth.
// Maps CLI flags + env vars onto one of:
//   { kind: "apiKey", key }
//   { kind: "x402",   keys: { evm, solana }, preferSolana }
//   { kind: "mpp",    key }
// Call resolveAuth() once per command and pass the result through fetchAPI
// and api.* helpers. Key detection and validation live here; the payment
// fetch wrappers only consume the resolved value.

import { getApiKey } from "../config.js";

export function basicAuthHeader(key) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

// Solana keypairs are 64 bytes; base58-encoded they are 87-88 characters.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const isEvmKey    = (k) => typeof k === "string" && k.startsWith("0x");
const isSolanaKey = (k) => typeof k === "string" && !k.startsWith("0x") && BASE58_RE.test(k) && k.length >= 87;

function authError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function resolveX402Keys(env) {
  const wallet = env.WALLET_PRIVATE_KEY || "";
  return {
    evm:    env.EVM_PRIVATE_KEY    || (isEvmKey(wallet)    ? wallet : ""),
    solana: env.SOLANA_PRIVATE_KEY || (isSolanaKey(wallet) ? wallet : ""),
  };
}

function resolveMppKey(env) {
  return env.TEMPO_PRIVATE_KEY || env.WALLET_PRIVATE_KEY || "";
}

// Resolves apiKey auth without looking at pay-per-call env vars. Used both
// by resolveAuth's default branch and by callers that never support
// pay-per-call (e.g., fetchAPI's fallback for trading commands).
export function resolveApiKeyAuth() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw authError(
      "missing_api_key",
      "ZERION_API_KEY is required. Get one at https://developers.zerion.io\n" +
      "Alternatively, use --x402 or --mpp for pay-per-call (no API key needed)."
    );
  }
  return { kind: "apiKey", key: apiKey };
}

export function resolveAuth(flags = {}, env = process.env) {
  const wantsMpp  = flags.mpp  === true || env.ZERION_MPP  === "true";
  const wantsX402 = flags.x402 === true || env.ZERION_X402 === "true";

  // Default: API key. Pay-per-call is an explicit opt-in below.
  if (!wantsMpp && !wantsX402) {
    return resolveApiKeyAuth();
  }

  if (wantsMpp && wantsX402) {
    throw authError("mutually_exclusive_auth", "--x402 and --mpp are mutually exclusive");
  }

  if (wantsMpp) {
    const key = resolveMppKey(env);
    if (!key) {
      throw authError(
        "missing_mpp_key",
        "MPP mode requires a private key. Set TEMPO_PRIVATE_KEY or WALLET_PRIVATE_KEY."
      );
    }
    if (!isEvmKey(key)) {
      throw authError(
        "invalid_mpp_key",
        "MPP requires an EVM private key (0x-prefixed).\n" +
        "WALLET_PRIVATE_KEY appears to be a Solana key — set TEMPO_PRIVATE_KEY=0x... for MPP."
      );
    }
    return { kind: "mpp", key };
  }

  // wantsX402
  const keys = resolveX402Keys(env);
  if (!keys.evm && !keys.solana) {
    throw authError(
      "missing_x402_key",
      "x402 mode requires a private key.\n" +
      "  EVM (Base):  set WALLET_PRIVATE_KEY=0x...  or  EVM_PRIVATE_KEY=0x...\n" +
      "  Solana:      set WALLET_PRIVATE_KEY=<base58>  or  SOLANA_PRIVATE_KEY=<base58>"
    );
  }
  return {
    kind: "x402",
    keys,
    preferSolana: env.ZERION_X402_PREFER_SOLANA === "true",
  };
}
