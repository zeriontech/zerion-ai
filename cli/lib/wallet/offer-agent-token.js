/**
 * Shared post-wallet-creation flow: offer to create an agent token.
 * Used by both `wallet create` and `wallet import`.
 */

import * as ows from "./keystore.js";
import { print } from "../util/output.js";
import { confirm } from "../util/prompt.js";
import { setConfigValue } from "../config.js";

/**
 * Offer agent token creation after wallet setup.
 * Non-TTY: auto-creates token (script/agent workflows).
 * TTY: prompts the user interactively.
 */
export async function offerAgentToken(walletName, passphrase) {
  if (!process.stdin.isTTY) {
    return autoCreateToken(walletName, passphrase);
  }

  const yes = await confirm("\nCreate an agent token for unattended trading? (y/n) ");
  if (!yes) {
    process.stderr.write(
      `Skipped. You can create one later:\n` +
      `  zerion agent create-token --name "my-bot" --wallet ${walletName}\n\n`
    );
    return;
  }

  try {
    const result = ows.createAgentToken(`${walletName}-agent`, walletName, passphrase);
    setConfigValue("agentToken", result.token);
    process.stderr.write(
      `\nAgent token saved to config. All trading commands will use it automatically.\n\n`
    );
  } catch (err) {
    process.stderr.write(`Warning: could not create agent token: ${err.message}\n\n`);
  }
}

function autoCreateToken(walletName, passphrase) {
  try {
    const result = ows.createAgentToken(`${walletName}-agent`, walletName, passphrase);
    setConfigValue("agentToken", result.token);
    process.stderr.write(
      `\nAgent token created and saved to config.\n`
    );
    print({ agentToken: { name: result.name, saved: true } });
  } catch (err) {
    process.stderr.write(`\nWarning: could not auto-create agent token: ${err.message}\n\n`);
  }
}
