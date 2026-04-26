/**
 * Secure stdin reader — prompts for sensitive input without exposing it in process.argv.
 */

import { createInterface } from "node:readline";

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
