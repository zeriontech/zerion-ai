import { getAddress, isAddressEqual, toHex } from "viem";
import * as ows from "../wallet/keystore.js";
import { requireAgentToken } from "../trading/guards.js";
import { signMessageViaWebApp, toTypedDataSignRequest } from "../web-app/handoff.js";
import { assertHashMatches, hashSafeTx } from "./safe-tx.js";
import { normalizeOwnerSignature, recoverSafeSigner } from "./signatures.js";

const ROUTES = new Set(["local", "web-app"]);
const SIGN_MODES = new Set(["typed", "hash"]);

const HASH_MODE_SUGGESTION =
  "If your wallet cannot sign EIP-712 typed data, retry with --sign-mode hash to sign the safeTxHash instead.";

let keystore = ows;

// Test seam: lets unit tests swap the OWS keystore for a stub.
export function __setKeystoreForTests(stub) {
  keystore = stub ?? ows;
}

function ownerSignError(code, message, { cause, suggestion, reason } = {}) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.code = code;
  if (suggestion) err.suggestion = suggestion;
  if (reason) err.reason = reason;
  return err;
}

function toSafeSignRequest({ typedData, safeTxHash, chainIdNum, signMode }) {
  if (signMode === "typed") return toTypedDataSignRequest(typedData, { chainIdNum });
  const raw = safeTxHash.toLowerCase();
  return {
    kind: "personal",
    raw,
    chainId: toHex(chainIdNum),
    safeTx: { safeTxHash: raw, safe: getAddress(typedData.domain.verifyingContract), chainId: chainIdNum },
  };
}

async function signLocally({ typedData, chainIdNum, signer }) {
  const passphrase = await requireAgentToken("for Safe signing", signer.walletName);
  let result;
  try {
    result = keystore.signTypedData(signer.walletName, JSON.stringify(typedData), passphrase, `eip155:${chainIdNum}`);
  } catch (err) {
    throw ownerSignError("safe_sign_failed", `Failed to sign the SafeTx locally: ${err.message}`, { cause: err });
  }
  return result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
}

function webAppError(result, signMode) {
  const suggestion = signMode === "typed" ? HASH_MODE_SUGGESTION : undefined;
  switch (result.status) {
    case "rejected":
      return ownerSignError(
        "safe_sign_rejected",
        `The Safe transaction was rejected in the Zerion web app${result.reason ? `: ${result.reason}` : "."}`,
        { suggestion, reason: result.reason }
      );
    case "timeout":
      return ownerSignError("safe_sign_timeout", "Timed out waiting for the owner's signature from the Zerion web app.");
    case "aborted":
      return ownerSignError(
        "safe_sign_aborted",
        "Aborted while waiting for the owner's signature from the Zerion web app."
      );
    default:
      return ownerSignError(
        "safe_sign_failed",
        `Signing the Safe transaction in the Zerion web app failed${result.error ? `: ${result.error}` : "."}`,
        { suggestion }
      );
  }
}

async function signOnWebApp({ typedData, safeTxHash, chainIdNum, signer, signMode, timeout }) {
  const result = await signMessageViaWebApp({
    address: signer.address,
    message: toSafeSignRequest({ typedData, safeTxHash, chainIdNum, signMode }),
    timeout,
  });
  if (result.status !== "completed") throw webAppError(result, signMode);
  return result.signature;
}

/**
 * Collect one owner's signature over a built SafeTx, locally (OWS keystore,
 * EIP-712 only) or through the Zerion web app (EIP-712, or eth_sign over the
 * safeTxHash in hash mode), and return it in Safe form after checking that it
 * recovers to the owner.
 *
 * @returns {Promise<{ owner: string, signature: string, signMode: 'typed'|'hash', signedVia: 'local'|'web-app' }>}
 */
export async function signSafeTxAsOwner({
  typedData,
  safeTxHash,
  chainIdNum,
  signer,
  route,
  signMode = "typed",
  timeout,
}) {
  if (!ROUTES.has(route)) throw new TypeError(`Unknown Safe signing route "${route}".`);
  if (!SIGN_MODES.has(signMode)) throw new TypeError(`Unknown Safe sign mode "${signMode}".`);
  assertHashMatches(hashSafeTx(typedData), safeTxHash);

  if (route === "local" && signMode === "hash") {
    throw ownerSignError(
      "sign_mode_requires_review",
      "--sign-mode hash is only available when signing in the Zerion web app.",
      { suggestion: "Add --review to sign the safeTxHash in the Zerion web app, or drop --sign-mode hash." }
    );
  }

  const rawSignature =
    route === "local"
      ? await signLocally({ typedData, chainIdNum, signer })
      : await signOnWebApp({ typedData, safeTxHash, chainIdNum, signer, signMode, timeout });

  let signature;
  try {
    signature = normalizeOwnerSignature({ signature: rawSignature, mode: signMode });
  } catch (err) {
    throw ownerSignError("safe_sign_failed", `The ${route} signer returned an unusable signature: ${err.message}`, {
      cause: err,
    });
  }

  const recovered = await recoverSafeSigner({ signature, typedData, safeTxHash });
  if (!isAddressEqual(recovered, signer.address)) {
    throw ownerSignError(
      "safe_signature_mismatch",
      `The signature recovers to ${recovered}, not to the signing owner ${getAddress(signer.address)}.`
    );
  }

  return { owner: getAddress(signer.address), signature, signMode, signedVia: route };
}
