import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { CONFIG_DIR, CONFIG_PATH, DEFAULT_SLIPPAGE, DEFAULT_CHAIN, WALLET_ORIGIN } from "./util/constants.js";

const DEFAULTS = {
  apiKey: null,
  defaultWallet: null,
  slippage: DEFAULT_SLIPPAGE,
  defaultChain: DEFAULT_CHAIN,
};

let _configCache = null;

export function loadConfig() {
  if (_configCache) return _configCache;
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    _configCache = { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) };
    return _configCache;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  _configCache = config;
}

export function getConfigValue(key) {
  return loadConfig()[key];
}

export function setConfigValue(key, value) {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function unsetConfigValue(key) {
  const config = loadConfig();
  delete config[key];
  saveConfig(config);
}

export function getApiKey() {
  return process.env.ZERION_API_KEY || getConfigValue("apiKey");
}

export function setWalletOrigin(walletName, origin) {
  const origins = getConfigValue("walletOrigins") || {};
  origins[walletName] = origin;
  setConfigValue("walletOrigins", origins);
}

export function getWalletOrigin(walletName) {
  const origins = getConfigValue("walletOrigins") || {};
  return origins[walletName] || WALLET_ORIGIN.MNEMONIC;
}

export function removeWalletOrigin(walletName) {
  const origins = getConfigValue("walletOrigins") || {};
  delete origins[walletName];
  setConfigValue("walletOrigins", origins);
}

/**
 * Filter wallet addresses based on import origin.
 * Only returns addresses for chains the user actually imported keys for.
 */
export function getWalletAddresses(wallet, origin) {
  const result = {};
  if (origin !== WALLET_ORIGIN.SOL_KEY) result.evmAddress = wallet.evmAddress;
  if (origin !== WALLET_ORIGIN.EVM_KEY) result.solAddress = wallet.solAddress;
  return result;
}

/**
 * Agent tokens — stored as { walletName: tokenString } map.
 * Active token is always agentTokens[defaultWallet]. No separate pointer needed.
 */
export function saveAgentToken(walletName, token) {
  const tokens = getConfigValue("agentTokens") || {};
  tokens[walletName] = token;
  setConfigValue("agentTokens", tokens);
}

export function getActiveAgentToken() {
  const wallet = getConfigValue("defaultWallet");
  if (!wallet) return null;
  const tokens = getConfigValue("agentTokens") || {};
  return tokens[wallet] || null;
}

export function getAgentTokenForWallet(walletName) {
  const tokens = getConfigValue("agentTokens") || {};
  return tokens[walletName] || null;
}

export function listSavedAgentTokens() {
  return getConfigValue("agentTokens") || {};
}

export function removeAgentTokensForWallet(walletName) {
  const tokens = getConfigValue("agentTokens") || {};
  delete tokens[walletName];
  setConfigValue("agentTokens", tokens);
}
