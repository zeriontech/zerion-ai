import readline from "node:readline";
import { setConfigValue, getApiKey } from "../lib/config.js";
import { print, printError } from "../lib/util/output.js";
import { browserLogin } from "../lib/auth/browser-flow.js";

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

export default async function loginCmd(args, flags) {
  const existingKey = getApiKey();
  if (existingKey && !flags.force) {
    process.stderr.write("Already logged in. Use --force to replace the current API key.\n");
    print({ loggedIn: true });
    return;
  }

  // Direct key mode
  if (flags["api-key"]) {
    const key = flags["api-key"];
    if (typeof key !== "string" || !key.startsWith("zk-")) {
      printError("invalid_key_format", "API keys start with 'zk-'");
      process.exit(1);
    }
    setConfigValue("apiKey", key);
    print({ loggedIn: true, method: "api-key" });
    return;
  }

  // Browser mode (explicit flag)
  if (flags.browser) {
    return runBrowser();
  }

  // Interactive: ask whether to use the browser
  const choice = await prompt("Open browser to authenticate? (Y/n) ");
  if (choice === "" || choice.toLowerCase().startsWith("y")) {
    return runBrowser();
  }

  // Manual paste fallback
  const key = await prompt("Enter your Zerion API key: ");
  if (!key || !key.startsWith("zk-")) {
    printError("invalid_key_format", "API keys start with 'zk-'");
    process.exit(1);
  }
  setConfigValue("apiKey", key);
  print({ loggedIn: true, method: "api-key" });
}

async function runBrowser() {
  try {
    const result = await browserLogin();
    setConfigValue("apiKey", result.apiKey);
    const email = result.email || "(unknown)";
    const team = result.teamName || "(unknown)";
    process.stderr.write(`\nLogged in as ${email} (team: ${team})\n`);
    print({ loggedIn: true, method: "browser", email: result.email, team: result.teamName });
  } catch (err) {
    printError("login_failed", err.message || "Login failed");
    process.exit(1);
  }
}
