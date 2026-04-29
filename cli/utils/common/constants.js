import { homedir } from "node:os";

export const API_BASE = process.env.ZERION_API_BASE || "https://api.zerion.io/v1";
export const HOME = process.env.HOME || process.env.USERPROFILE || homedir();
export const CONFIG_DIR = `${HOME}/.zerion`;
export const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
export const DEFAULT_SLIPPAGE = 2;
export const DEFAULT_CHAIN = "ethereum";
export const NATIVE_ASSET_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// Wallet origin types — how the wallet was created/imported
export const WALLET_ORIGIN = {
  MNEMONIC: "mnemonic",
  EVM_KEY: "evm-key",
  SOL_KEY: "sol-key",
};

// Passphrase warning shown during wallet create and import
export const PASSPHRASE_WARNING =
  "\nWARNING: This passphrase is the ONLY way to recover your wallet or\n" +
  "create new agent tokens. There is no reset or recovery mechanism.\n" +
  "If you lose it, your funds are permanently inaccessible.\n\n";

// Browser-login destination and polling endpoint (overridable for staging/tests).
export const WEB_URL = process.env.ZERION_WEB_URL || "https://developers.zerion.io";
export const CLI_STATUS_URL = process.env.ZERION_CLI_STATUS_URL || `${WEB_URL}/api/cli/status`;
