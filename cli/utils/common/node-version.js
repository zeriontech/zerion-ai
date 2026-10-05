/**
 * Node.js version check. Some dependencies (rpc-websockets via @solana/web3.js)
 * require() ESM-only packages, which Node only supports by default from
 * 20.19 / 22.12 (and 23+). On older versions the CLI crashes while loading,
 * so we fail early with a structured error instead.
 */

import { printError } from "./output.js";

export const SUPPORTED_NODE_RANGE = "^20.19.0 || >=22.12.0";

export function isSupportedNodeVersion(version) {
  const [major, minor] = String(version).replace(/^v/, "").split(".").map(Number);
  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  return major >= 23;
}

export function exitIfUnsupportedNode(version = process.versions.node) {
  if (isSupportedNodeVersion(version)) return;
  printError(
    "unsupported_node",
    `Node.js ${version} is not supported. zerion requires Node.js ${SUPPORTED_NODE_RANGE}.`,
    {
      nodeVersion: version,
      required: SUPPORTED_NODE_RANGE,
      suggestion: "Upgrade Node.js to 22.12+ (or 20.19+), e.g. `nvm install 22`, then re-run.",
    }
  );
  process.exit(1);
}
