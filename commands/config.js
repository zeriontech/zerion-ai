import { loadConfig, getConfigValue, setConfigValue, unsetConfigValue } from "../lib/config.js";
import { print, printError } from "../lib/util/output.js";

const VALID_KEYS = ["apiKey", "defaultWallet", "slippage", "defaultChain"];
const SENSITIVE_KEYS = new Set(["apiKey"]);
const INTERNAL_KEYS = new Set(["walletOrigins", "agentTokens"]);

function redact(key, val) {
  if (!SENSITIVE_KEYS.has(key) || !val) return val;
  return val.length > 8 ? val.slice(0, 8) + "..." : "***";
}

export default async function configCmd(args, flags) {
  const [action, key, ...valueParts] = args;
  const value = valueParts.join(" ");

  switch (action) {
    case "list": {
      const raw = loadConfig();
      const config = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === null || v === undefined) continue;
        if (INTERNAL_KEYS.has(k)) continue;
        config[k] = SENSITIVE_KEYS.has(k) ? redact(k, v) : v;
      }
      print({ config });
      break;
    }

    case "get": {
      if (!key) {
        printError("missing_key", "Specify a config key", {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      if (!VALID_KEYS.includes(key)) {
        printError("invalid_key", `Unknown config key: ${key}`, {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      const val = getConfigValue(key);
      print({ [key]: redact(key, val) });
      break;
    }

    case "set": {
      if (!key || value === undefined || value === null || value === "") {
        printError("missing_input", "Usage: zerion config set <key> <value>", {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      if (!VALID_KEYS.includes(key)) {
        printError("invalid_key", `Unknown config key: ${key}`, {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      const parsed = key === "slippage" ? parseFloat(value) : value;
      setConfigValue(key, parsed);
      print({ [key]: redact(key, value), updated: true });
      break;
    }

    case "unset": {
      if (!key) {
        printError("missing_key", "Specify a config key to unset", {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      if (!VALID_KEYS.includes(key)) {
        printError("invalid_key", `Unknown config key: ${key}`, {
          validKeys: VALID_KEYS,
        });
        process.exit(1);
      }
      unsetConfigValue(key);
      print({ [key]: null, removed: true });
      break;
    }

    default:
      printError("invalid_action", "Usage: zerion config <list|get|set|unset>", {
        suggestion: "zerion config list",
      });
      process.exit(1);
  }
}
