import { getAddress, parseAbi, hexToBigInt } from "viem";

export const SUPPORTED_SAFE_VERSIONS = ["1.3.0", "1.4.1", "1.5.0"];

const GUARD_STORAGE_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";
const MODULES_PAGE_SIZE = 10n;

const SAFE_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
]);

function read(client, address, functionName, args) {
  return client.readContract({ address, abi: SAFE_ABI, functionName, args });
}

function guardFromSlot(value) {
  if (!value || hexToBigInt(value) === 0n) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

export async function readSafeState(client, safeAddress) {
  const code = await client.getCode({ address: safeAddress });
  if (!code || code === "0x") {
    throw Object.assign(new Error(`No contract at ${safeAddress} on this chain`), { code: "safe_not_deployed" });
  }
  const [version, owners, threshold, nonce, [modules], guardSlot] = await Promise.all([
    read(client, safeAddress, "VERSION"),
    read(client, safeAddress, "getOwners"),
    read(client, safeAddress, "getThreshold"),
    read(client, safeAddress, "nonce"),
    read(client, safeAddress, "getModulesPaginated", [SENTINEL_MODULES, MODULES_PAGE_SIZE]),
    client.getStorageAt({ address: safeAddress, slot: GUARD_STORAGE_SLOT }),
  ]);
  return {
    version,
    owners: owners.map((o) => getAddress(o)),
    threshold: Number(threshold),
    nonce,
    guard: guardFromSlot(guardSlot),
    modules: modules.map((m) => getAddress(m)),
  };
}

export function assertSupportedVersion(version) {
  if (!SUPPORTED_SAFE_VERSIONS.includes(version)) {
    throw Object.assign(
      new Error(`Safe version "${version}" is not supported (supported: ${SUPPORTED_SAFE_VERSIONS.join(", ")})`),
      { code: "safe_version_unsupported", version },
    );
  }
}

export async function getOnchainSafeTxHash(client, safeAddress, message) {
  return read(client, safeAddress, "getTransactionHash", [
    message.to,
    BigInt(message.value),
    message.data,
    Number(message.operation),
    BigInt(message.safeTxGas),
    BigInt(message.baseGas),
    BigInt(message.gasPrice),
    message.gasToken,
    message.refundReceiver,
    BigInt(message.nonce),
  ]);
}
