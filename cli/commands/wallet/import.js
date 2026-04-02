import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { setConfigValue, getConfigValue } from "../../lib/config.js";
import { readSecret, readPassphrase } from "../../lib/util/prompt.js";
import { offerAgentToken } from "../../lib/wallet/offer-agent-token.js";

async function resolveSecretInput(flags, flagName, fileFlagName, prompt) {
  if (flags[fileFlagName]) {
    const filePath = resolve(flags[fileFlagName]);
    const lstat = lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Refusing to follow symlink: ${filePath}`);
    }
    if (!lstat.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
    const realPath = realpathSync(filePath);
    if (/^\/(etc|proc|sys|dev)\//.test(realPath)) {
      throw new Error(`Refusing to read sensitive system path: ${realPath}`);
    }
    return readFileSync(filePath, "utf-8").trim();
  }
  if (typeof flags[flagName] === "string" && flags[flagName].length > 0) {
    process.stderr.write(
      `⚠️  ${flagName} passed via CLI flag — visible in shell history and process list.\n` +
      `   Prefer: zerion wallet import --${flagName} (interactive) or --${fileFlagName} <path>\n\n`
    );
    return flags[flagName];
  }
  if (flags[flagName] === true || flags[flagName] === "") {
    return readSecret(prompt);
  }
  return null;
}

export default async function walletImport(args, flags) {
  const name = flags.name || args[0] || `imported-${Date.now()}`;

  if (!flags.key && !flags.mnemonic && !flags["key-file"] && !flags["mnemonic-file"]) {
    printError(
      "missing_input",
      "Provide --key, --key-file, --mnemonic, or --mnemonic-file",
      { suggestion: "zerion wallet import --key (prompts securely)\nzerion wallet import --key-file ./key.txt\nzerion wallet import --mnemonic (prompts securely)" }
    );
    process.exit(1);
  }

  const hasKey = flags.key || flags["key-file"];
  const hasMnemonic = flags.mnemonic || flags["mnemonic-file"];
  if (hasKey && hasMnemonic) {
    printError("invalid_input", "Provide either key or mnemonic, not both");
    process.exit(1);
  }

  // Security warning
  process.stderr.write(
    "⚠️  Your key will be stored locally encrypted (AES-256-GCM).\n" +
    "   If your machine is compromised, the key can be extracted.\n\n"
  );

  try {
    // Passphrase: interactive by default, or --passphrase-file for agent workflows
    if (!flags["passphrase-file"]) {
      process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    }
    const passphrase = await readPassphrase({
      confirm: !flags["passphrase-file"],
      passphraseFile: flags["passphrase-file"],
    });

    let wallet;
    if (hasKey) {
      const key = await resolveSecretInput(flags, "key", "key-file", "Enter private key (hex): ");
      wallet = ows.importFromKey(name, key, passphrase);
    } else {
      const mnemonic = await resolveSecretInput(flags, "mnemonic", "mnemonic-file", "Enter mnemonic phrase: ");
      wallet = ows.importFromMnemonic(name, mnemonic, passphrase);
    }

    if (!getConfigValue("defaultWallet")) {
      setConfigValue("defaultWallet", name);
    }

    print({
      wallet: {
        name: wallet.name,
        evmAddress: wallet.evmAddress,
      },
      imported: true,
    });

    // Offer agent token creation as part of wallet setup
    await offerAgentToken(name, passphrase);
  } catch (err) {
    printError("ows_error", `Failed to import wallet: ${err.message}`);
    process.exit(1);
  }
}
