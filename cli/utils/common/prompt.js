/**
 * Secure stdin reader — prompts for sensitive input without exposing it in process.argv.
 */

import { createInterface } from "node:readline";
import { readFileSync, statSync } from "node:fs";

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
 * Requires an interactive terminal — passphrase must always be entered by a human.
 */
export async function readPassphrase({ confirm = false } = {}) {
  if (!process.stdin.isTTY) {
    throw new Error("Passphrase must be entered in an interactive terminal.");
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
 * Read a passphrase from a file. Used for non-interactive automation
 * (CI, headless servers, scripted agent setup).
 *
 * Security: on POSIX, refuse to read the file unless it is mode 0600
 * AND owned by the current uid. The passphrase unlocks the keystore —
 * same threat model as an SSH private key, same perm + ownership
 * requirement. Without the uid check, a symlink at the given path
 * could resolve to another user's 0600 file on a shared host. Perm
 * and ownership checks are skipped on Windows (POSIX mode bits and
 * uid are not meaningful there; use NTFS ACLs instead).
 *
 * Strips exactly one trailing newline (\n or \r\n) — passphrases may
 * legitimately contain leading/trailing spaces, so don't .trim().
 */
export function readPassphraseFromFile(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Passphrase file not found: ${path}`);
    }
    throw new Error(`Cannot read passphrase file: ${err.message}`);
  }

  if (!stat.isFile()) {
    throw new Error(`Passphrase file is not a regular file: ${path}`);
  }

  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0) {
      const got = (stat.mode & 0o777).toString(8).padStart(3, "0");
      throw new Error(
        `Passphrase file ${path} has insecure permissions (mode ${got}). ` +
          `Run: chmod 600 ${path}`
      );
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error(
        `Passphrase file ${path} is not owned by the current user (uid ${stat.uid}). ` +
          `Refusing to read another user's file.`
      );
    }
  }

  const raw = readFileSync(path, "utf8");
  const passphrase = raw.endsWith("\r\n")
    ? raw.slice(0, -2)
    : raw.endsWith("\n")
      ? raw.slice(0, -1)
      : raw;

  if (!passphrase) {
    throw new Error(`Passphrase file is empty: ${path}`);
  }

  return passphrase;
}

/**
 * Simple y/n confirmation prompt. Returns true for yes, false for no.
 * Defaults to yes on empty input (use `defaultYes: false` to invert).
 */
export function confirm(message, { defaultYes = true } = {}) {
  return new Promise((done) => {
    process.stderr.write(message);

    const parse = (raw) => {
      const a = raw.trim().toLowerCase();
      if (a === "") return defaultYes;
      if (a.startsWith("y")) return true;
      if (a.startsWith("n")) return false;
      return defaultYes;
    };

    if (process.stdin.isTTY) {
      // Canonical mode: the terminal line-buffers input; Node delivers a full
      // line (including trailing \n) in one `data` event when the user hits Enter.
      process.stdin.setEncoding("utf8");
      process.stdin.resume();
      const onData = (chunk) => {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        done(parse(chunk));
      };
      process.stdin.on("data", onData);
      return;
    }

    // Non-TTY (piped): use readline so we get one line, then resolve.
    // IMPORTANT: resolve via `done()` before calling `rl.close()` — close fires
    // synchronously and the close handler would otherwise race the line result.
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      done(value);
    };
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    rl.once("line", (line) => {
      finish(parse(line));
      rl.close();
    });
    rl.once("close", () => finish(defaultYes));
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
