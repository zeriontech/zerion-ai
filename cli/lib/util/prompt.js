/**
 * Secure stdin reader — prompts for sensitive input without exposing it in process.argv.
 */

import { createInterface } from "node:readline";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export function readSecret(prompt, { mask = false } = {}) {
  return new Promise((resolve) => {
    process.stderr.write(prompt);

    // If masking and stdin is a TTY, use raw mode to replace each keystroke with *
    if (mask && process.stdin.isTTY) {
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (ch) => {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          // Enter or Ctrl-D — done
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(input.trim());
        } else if (ch === "\u0003") {
          // Ctrl-C — abort
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write("\n");
          process.exit(130);
        } else if (ch === "\u007F" || ch === "\b") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stderr.write("\b \b");
          }
        } else {
          input += ch;
          process.stderr.write("*");
        }
      };

      process.stdin.on("data", onData);
      return;
    }

    // Fallback: no masking (non-TTY or mask=false)
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

/**
 * Prompt for a passphrase with optional confirmation (enter twice).
 * Refuses to proceed if stdin is not a TTY (prevents silent scripted bypass)
 * — unless a passphrase file is provided for agent/script workflows.
 */
export async function readPassphrase({ confirm = false, passphraseFile = null } = {}) {
  // File-based passphrase for agent/script workflows (no TTY needed)
  if (passphraseFile) {
    const filePath = resolve(passphraseFile);

    // Verify it exists and is a regular file (not a symlink, directory, device)
    let lstat;
    try {
      lstat = lstatSync(filePath);
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`Passphrase file not found: ${filePath}`);
      if (err.code === "EACCES") throw new Error(`Permission denied reading passphrase file: ${filePath}`);
      throw new Error(`Cannot access passphrase file ${filePath}: ${err.message}`);
    }
    if (lstat.isSymbolicLink()) {
      throw new Error(`Refusing to follow symlink for passphrase file: ${filePath}`);
    }
    if (!lstat.isFile()) {
      throw new Error(`Passphrase path is not a regular file: ${filePath}`);
    }

    // Reject sensitive system paths (check after resolving to catch traversal)
    const realPath = realpathSync(filePath);
    if (/^\/(etc|proc|sys|dev)\//.test(realPath)) {
      throw new Error(`Refusing to read system path as passphrase file: ${realPath}`);
    }

    const passphrase = readFileSync(filePath, "utf-8").trim();
    if (!passphrase) {
      throw new Error(`Passphrase file is empty: ${filePath}`);
    }
    return passphrase;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Passphrase must be entered in an interactive terminal.\n" +
      "For agent/script usage, pass --passphrase-file <path> to read from a file."
    );
  }

  while (true) {
    const passphrase = await readSecret("Enter passphrase: ", { mask: true });
    if (!passphrase) {
      process.stderr.write("Passphrase cannot be empty. Try again.\n\n");
      continue;
    }

    if (confirm) {
      const again = await readSecret("Confirm passphrase: ", { mask: true });
      if (passphrase !== again) {
        process.stderr.write("Passphrases do not match. Try again.\n\n");
        continue;
      }
    }

    return passphrase;
  }
}

/**
 * Simple y/n confirmation prompt. Returns true for yes, false for no.
 */
export function confirm(message) {
  return new Promise((done) => {
    process.stderr.write(message);
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      done(line.trim().toLowerCase().startsWith("y"));
    });
    rl.once("close", () => done(false)); // treat EOF as "no"
  });
}

/**
 * Run a policy check function from stdin JSON.
 * Used by standalone policy scripts (deny-transfers, deny-approvals, allowlist).
 */
export function runPolicyFromStdin(checkFn) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      const ctx = JSON.parse(input);
      console.log(JSON.stringify(checkFn(ctx)));
    } catch (e) {
      console.log(JSON.stringify({ allow: false, reason: `Policy error: ${e.message}` }));
    }
  });
}
