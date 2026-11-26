import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { CONFIG_DIR } from "../common/constants.js";

export function pendingReceiptPath({ safeAddress, chainId, safeTxHash }) {
  return join(CONFIG_DIR, "safe-pending", getAddress(safeAddress), String(chainId), `${safeTxHash.toLowerCase()}.json`);
}

export function writePendingReceipt({ safeAddress, chainId, safeTxHash, typedData, signatures, status }) {
  const path = pendingReceiptPath({ safeAddress, chainId, safeTxHash });
  mkdirSync(join(CONFIG_DIR, "safe-pending", getAddress(safeAddress), String(chainId)), { recursive: true, mode: 0o700 });
  const receipt = { safeTx: typedData, signatures, origin: "zerion-cli", status };
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  return path;
}
