/**
 * Post-wallet-creation prompt: if the user has no API key configured,
 * offer to run `zerion login` inline so they can actually use the CLI.
 *
 * Skipped silently when an API key is already available (saved in config
 * or via ZERION_API_KEY env var).
 */

import readline from "node:readline";
import { getApiKey } from "../config.js";
import loginCmd from "../../commands/login.js";

function promptYesDefault(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      // Empty (just Enter) accepts the default (Yes).
      resolve(a === "" || a.startsWith("y"));
    });
  });
}

export async function offerLogin() {
  if (getApiKey()) return;

  // Non-TTY environments (CI, pipes) shouldn't hit an interactive prompt —
  // leave a hint on stderr and move on.
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "\nNote: no ZERION_API_KEY configured. Run `zerion login` to get one.\n"
    );
    return;
  }

  process.stderr.write(
    "\nTo use the Zerion CLI (portfolio, swap, analyze, …) you need an API key.\n"
  );

  const yes = await promptYesDefault("Run `zerion login` now to get one? (Y/n) ");
  if (!yes) {
    process.stderr.write(
      "Skipped. Run `zerion login` any time, or set ZERION_API_KEY in your shell.\n\n"
    );
    return;
  }

  try {
    await loginCmd([], { browser: true, quiet: true });
  } catch (err) {
    // Don't abort the surrounding wallet-setup flow — the wallet is already
    // created and the user still needs the agent-token offer. Surface the
    // failure and point them at a clean retry.
    process.stderr.write(
      `\nLogin skipped: ${err.message || "failed"}. ` +
      "Run `zerion login` any time to finish setup.\n\n"
    );
  }
}
