/**
 * One-time migration from zerion-cli → zerion.
 * Moves ~/.zerion-cli to ~/.zerion and prints a notice on stderr
 * (stderr so JSON stdout stays clean for agent consumers).
 */

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./constants.js";

const OLD_DIR = join(HOME, ".zerion-cli");
const NEW_DIR = join(HOME, ".zerion");

function notice(obj) {
  process.stderr.write(JSON.stringify(obj) + "\n");
}

export function migrateFromZerionCli() {
  if (!existsSync(OLD_DIR)) return;

  if (!existsSync(NEW_DIR)) {
    try {
      renameSync(OLD_DIR, NEW_DIR);
      notice({
        notice: "migration",
        message: "zerion-cli has been renamed to zerion",
        migrated: { from: OLD_DIR, to: NEW_DIR },
        action: "npm uninstall -g zerion-cli",
      });
    } catch {
      notice({
        notice: "migration",
        message: "Could not migrate ~/.zerion-cli → ~/.zerion. Please move it manually.",
        migrated: false,
      });
    }
  } else {
    notice({
      notice: "migration",
      message: "zerion-cli has been renamed to zerion. You can remove ~/.zerion-cli.",
      migrated: false,
    });
  }
}
