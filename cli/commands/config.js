import { loadConfig, getConfigValue, setConfigValue } from "../lib/config.js";
import { print, printError } from "../lib/util/output.js";

const VALID_KEYS = ["apiKey", "defaultWallet", "slippage", "defaultChain"];

export default async function configCmd(args, flags) {
  const [action, key, ...valueParts] = args;
  const value = valueParts.join(" ");

  switch (action) {
    case "list": {
      const config = loadConfig();
      // Mask API key for security
      if (config.apiKey) {
        config.apiKey = config.apiKey.slice(0, 10) + "...";
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
      const val = getConfigValue(key);
      print({ [key]: key === "apiKey" && val ? val.slice(0, 10) + "..." : val });
      break;
    }

    case "set": {
      if (!key || !value) {
        printError("missing_input", "Usage: zerion-cli config set <key> <value>", {
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
      // Parse numeric values
      const parsed = key === "slippage" ? parseFloat(value) : value;
      setConfigValue(key, parsed);
      print({ [key]: key === "apiKey" ? value.slice(0, 10) + "..." : parsed, updated: true });
      break;
    }

    default:
      printError("invalid_action", "Usage: zerion-cli config <list|get|set>", {
        suggestion: "zerion-cli config list",
      });
      process.exit(1);
  }
}
