import { readFileSync } from "node:fs";
import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { setConfigValue, getConfigValue } from "../../lib/config.js";
import { readSecret, readPassphrase } from "../../lib/util/prompt.js";

async function resolveSecretInput(flags, flagName, fileFlagName, prompt) {
  if (flags[fileFlagName]) {
    return readFileSync(flags[fileFlagName], "utf-8").trim();
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
    // Passphrase is mandatory and must be entered interactively (never via --passphrase flag)
    process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    const passphrase = await readPassphrase({ confirm: true });

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
  } catch (err) {
    printError("ows_error", `Failed to import wallet: ${err.message}`);
    process.exit(1);
  }
}
