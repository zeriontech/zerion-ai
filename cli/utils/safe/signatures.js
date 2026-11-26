import { concat, getAddress, pad, recoverMessageAddress, recoverTypedDataAddress } from "viem";

const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

const SAFE_V_BY_MODE = {
  typed: new Map([[0, 27], [1, 28], [27, 27], [28, 28]]),
  hash: new Map([[0, 31], [1, 32], [27, 31], [28, 32], [31, 31], [32, 32]]),
};

function signatureError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function splitSignature(signature) {
  if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
    throw signatureError(
      "safe_signature_malformed",
      "Owner signature must be a 65-byte hex string (r, s, v)."
    );
  }
  const lower = signature.toLowerCase();
  return { rs: lower.slice(0, 130), v: parseInt(lower.slice(130), 16) };
}

function withV(rs, v) {
  return `${rs}${v.toString(16).padStart(2, "0")}`;
}

export function normalizeOwnerSignature({ signature, mode }) {
  if (!Object.hasOwn(SAFE_V_BY_MODE, mode)) {
    throw signatureError("safe_signature_malformed", `Unknown owner signature mode "${mode}".`);
  }
  const mapping = SAFE_V_BY_MODE[mode];
  const { rs, v } = splitSignature(signature);
  if (!mapping.has(v)) {
    throw signatureError(
      "safe_signature_malformed",
      `Owner signature v=${v} is not valid for ${mode === "typed" ? "an EIP-712" : "an eth_sign"} signature.`
    );
  }
  return withV(rs, mapping.get(v));
}

export async function recoverSafeSigner({ signature, typedData, safeTxHash }) {
  const { rs, v } = splitSignature(signature);
  if (v === 27 || v === 28) {
    return recoverTypedDataAddress({ ...typedData, signature: withV(rs, v) });
  }
  if (v === 31 || v === 32) {
    return recoverMessageAddress({ message: { raw: safeTxHash }, signature: withV(rs, v - 4) });
  }
  if (v === 1) {
    return getAddress(`0x${rs.slice(26, 66)}`);
  }
  throw signatureError(
    "safe_signature_malformed",
    `Owner signature v=${v} is not a Safe EOA signature type (1, 27, 28, 31 or 32).`
  );
}

export function preApprovedSignature(owner) {
  return concat([pad(getAddress(owner).toLowerCase(), { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
}

export function encodeSignatures(entries) {
  const seen = new Set();
  const keyed = entries.map(({ owner, signature }) => {
    const key = BigInt(getAddress(owner));
    if (seen.has(key)) {
      throw signatureError(
        "safe_signature_duplicate_owner",
        `Owner ${getAddress(owner)} has more than one signature.`
      );
    }
    seen.add(key);
    splitSignature(signature);
    return { key, signature: signature.toLowerCase() };
  });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return concat(["0x", ...keyed.map((entry) => entry.signature)]);
}
