import { randomBytes } from "node:crypto";
import { openSync, writeSync, closeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { setConfigValue, getConfigValue } from "../../lib/config.js";
import { readPassphrase } from "../../lib/util/prompt.js";
import { offerAgentToken } from "../../lib/wallet/offer-agent-token.js";
import { CONFIG_DIR } from "../../lib/util/constants.js";

export default async function walletCreate(args, flags) {
  const name = flags.name || args[0] || generateName();

  // --agent mode: fully automated, no prompts, no passphrase exposure
  if (flags.agent) {
    return createAgentWallet(name, flags);
  }

  try {
    // Passphrase: interactive by default, or --passphrase-file for agent workflows
    if (!flags["passphrase-file"]) {
      process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    }
    const passphrase = await readPassphrase({
      confirm: !flags["passphrase-file"],
      passphraseFile: flags["passphrase-file"],
    });

    const wallet = ows.createWallet(name, passphrase);

    // Set as default wallet if none exists
    if (!getConfigValue("defaultWallet")) {
      setConfigValue("defaultWallet", name);
    }

    print({
      wallet: {
        name: wallet.name,
        evmAddress: wallet.evmAddress,
        solAddress: wallet.solAddress,
        chains: wallet.chains.length,
      },
      created: true,
      isDefault: getConfigValue("defaultWallet") === name,
    });

    // Offer agent token creation as part of wallet setup
    await offerAgentToken(name, passphrase);
  } catch (err) {
    printError("ows_error", `Failed to create wallet: ${err.message}`);
    process.exit(1);
  }
}

/**
 * --agent mode: create wallet + agent token in one shot, no interactive prompts.
 * Passphrase is auto-generated and saved to a recovery file (agent never sees it).
 */
async function createAgentWallet(name, flags) {
  // Sanitize wallet name to prevent path traversal in recovery file
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    printError("invalid_name", "Wallet name must contain only letters, numbers, hyphens, and underscores");
    process.exit(1);
  }

  try {
    // Generate a strong random passphrase — the agent never sees this
    const passphrase = randomBytes(32).toString("base64url");

    const wallet = ows.createWallet(name, passphrase);

    if (!getConfigValue("defaultWallet")) {
      setConfigValue("defaultWallet", name);
    }

    // Create agent token and save to config
    const tokenName = flags["token-name"] || `${name}-token`;
    const token = ows.createAgentToken(tokenName, name, passphrase);
    setConfigValue("agentToken", token.token);

    // Save passphrase to recovery file atomically (wx = create-only, fails if exists)
    const recoveryDir = join(CONFIG_DIR, "recovery");
    mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
    const recoveryPath = join(recoveryDir, `${name}.passphrase`);
    const fd = openSync(recoveryPath, "wx", 0o600);
    writeSync(fd, passphrase);
    closeSync(fd);

    print({
      wallet: {
        name: wallet.name,
        evmAddress: wallet.evmAddress,
        solAddress: wallet.solAddress,
      },
      agentToken: { name: token.name, saved: true },
      recoveryFile: recoveryPath,
      created: true,
    });

    process.stderr.write(
      `Wallet and agent token created. Token saved to config — trading commands will use it automatically.\n` +
      `Recovery passphrase saved to: ${recoveryPath} (owner-read only)\n`
    );
  } catch (err) {
    printError("ows_error", `Failed to create agent wallet: ${err.message}`);
    process.exit(1);
  }
}

function generateName() {
  try {
    const existing = ows.listWallets();
    return `wallet-${existing.length + 1}`;
  } catch (err) {
    process.stderr.write(`Warning: could not list wallets: ${err.message}\n`);
    return "wallet-1";
  }
}
