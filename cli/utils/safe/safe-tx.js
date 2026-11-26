import { getAddress, hashDomain, hashStruct, hashTypedData } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const SAFE_TX_TYPES = deepFreeze({
  EIP712Domain: [
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
});

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function safeTxError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function buildSafeTxMessage({ to, value, data, operation = 0, nonce }) {
  if (operation !== 0) {
    throw safeTxError(
      "safe_operation_unsupported",
      `Safe operation ${operation} is not supported; only CALL (0) is.`
    );
  }
  return {
    to: getAddress(to),
    value: BigInt(value).toString(),
    data: data || "0x",
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: BigInt(nonce).toString(),
  };
}

export function toSafeTypedData({ chainId, safeAddress, message }) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new TypeError(`Safe chainId must be a positive integer number, got ${String(chainId)}.`);
  }
  return {
    domain: { chainId, verifyingContract: getAddress(safeAddress) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message,
  };
}

export function hashSafeTx(typedData) {
  return hashTypedData(typedData);
}

export function safeTxHashes(typedData) {
  return {
    safeTxHash: hashTypedData(typedData),
    domainHash: hashDomain({ domain: typedData.domain, types: typedData.types }),
    messageHash: hashStruct({ data: typedData.message, primaryType: "SafeTx", types: typedData.types }),
  };
}

export function assertHashMatches(localHash, onchainHash) {
  const matches =
    HASH_PATTERN.test(localHash) &&
    HASH_PATTERN.test(onchainHash) &&
    localHash.toLowerCase() === onchainHash.toLowerCase();
  if (!matches) {
    throw safeTxError(
      "safe_hash_mismatch",
      `Local safeTxHash ${localHash} does not match the Safe's on-chain hash ${onchainHash}.`
    );
  }
}
