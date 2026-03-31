import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { CONFIG_DIR, CONFIG_PATH, DEFAULT_SLIPPAGE, DEFAULT_CHAIN } from "./util/constants.js";

const DEFAULTS = {
  apiKey: null,
  defaultWallet: null,
  slippage: DEFAULT_SLIPPAGE,
  defaultChain: DEFAULT_CHAIN,
};

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getConfigValue(key) {
  return loadConfig()[key];
}

export function setConfigValue(key, value) {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function getApiKey() {
  return process.env.ZERION_API_KEY || getConfigValue("apiKey");
}
