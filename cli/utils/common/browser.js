/**
 * Open a URL in the user's default browser. Best-effort and fire-and-forget —
 * callers always print the URL too so a headless / no-GUI environment can copy
 * it manually.
 */

import { spawnSync } from "node:child_process";

export function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32" });
}
