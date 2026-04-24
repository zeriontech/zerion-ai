import readline from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setConfigValue, getApiKey } from "../lib/config.js";
import { print, printError } from "../lib/util/output.js";
import { browserLogin } from "../lib/auth/browser-flow.js";
import { API_BASE, CONFIG_PATH } from "../lib/util/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function banner() {
  const w = (s) => process.stderr.write(s + "\n");
  w("");
  w(`  zerion cli v${pkg.version}`);
  w(`  Wallet analysis & autonomous trading for AI agents`);
  w("");
}

function maskKey(key) {
  if (!key || typeof key !== "string") return "(unknown)";
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function successBlock({ team, method, key }) {
  const w = (s) => process.stderr.write(s + "\n");
  w("");
  w(`✓ Login successful!`);
  if (team) w(`  Team:   ${team}`);
  w(`  API:    ${API_BASE}`);
  w(`  Key:    ${maskKey(key)}`);
  w(`  Config: ${CONFIG_PATH}`);
  w(`  Mode:   ${method}`);
  w("");
}

export default async function loginCmd(args, flags) {
  const existingKey = getApiKey();
  if (existingKey && !flags.force) {
    process.stderr.write("Already logged in. Use --force to replace the current API key.\n");
    print({ loggedIn: true, api: API_BASE, config: CONFIG_PATH, keyPrefix: maskKey(existingKey) });
    return;
  }

  if (flags["api-key"]) {
    const key = flags["api-key"];
    if (typeof key !== "string" || !key.startsWith("zk-")) {
      printError("invalid_key_format", "API keys start with 'zk-'");
      process.exit(1);
    }
    setConfigValue("apiKey", key);
    print({ loggedIn: true, method: "api-key", api: API_BASE, config: CONFIG_PATH, keyPrefix: maskKey(key) });
    return;
  }

  if (flags.browser) {
    banner();
    return runBrowser();
  }

  banner();
  const w = (s) => process.stderr.write(s + "\n");
  w(`Welcome! To get started, authenticate with your Zerion account.`);
  w("");
  w(`  1. Login with browser (recommended)`);
  w(`  2. Enter API key manually`);
  w("");
  w(`Tip: You can also set ZERION_API_KEY environment variable`);
  w(`     API endpoint: ${API_BASE}`);
  w("");

  const choice = await prompt("Enter choice [1/2]: ");
  if (choice === "" || choice === "1") {
    return runBrowser();
  }
  if (choice !== "2") {
    printError("invalid_choice", "Enter 1 or 2");
    process.exit(1);
  }

  const key = await prompt("Enter your Zerion API key: ");
  if (!key || !key.startsWith("zk-")) {
    printError("invalid_key_format", "API keys start with 'zk-'");
    process.exit(1);
  }
  setConfigValue("apiKey", key);
  successBlock({ method: "api-key", key });
  print({ loggedIn: true, method: "api-key", api: API_BASE });
}

async function runBrowser() {
  try {
    const result = await browserLogin();
    setConfigValue("apiKey", result.apiKey);
    successBlock({ team: result.teamName || "(unknown)", method: "browser", key: result.apiKey });
    print({
      loggedIn: true,
      method: "browser",
      email: result.email,
      team: result.teamName,
      api: API_BASE,
      config: CONFIG_PATH,
      keyPrefix: maskKey(result.apiKey),
    });
  } catch (err) {
    printError("login_failed", err.message || "Login failed");
    process.exit(1);
  }
}
