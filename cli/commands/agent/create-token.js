import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue, setConfigValue, saveAgentToken } from "../../utils/config.js";
import { readPassphrase, readPassphraseFromFile } from "../../utils/common/prompt.js";
import { pickPolicyInteractive } from "../../utils/wallet/policy-picker.js";

export default async function agentCreateToken(args, flags) {
  const name = flags.name || args[0];
  const walletName = flags.wallet || getConfigValue("defaultWallet");

  if (!name) {
    printError("missing_args", "Token name required", {
      example: 'zerion agent create-token --name "trading-bot" --wallet my-agent',
    });
    process.exit(1);
  }

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  // Validate passphrase-related flags up front (fail fast before any state lookup).
  // Reject --passphrase <value> — argv-passed secrets leak to ps/history/logs.
  if (Object.prototype.hasOwnProperty.call(flags, "passphrase")) {
    printError(
      "unsupported_flag",
      "--passphrase is not supported (argv-passed secrets leak to `ps`, shell history, and CI logs).",
      {
        suggestion:
          "Use --passphrase-file <path> instead. Write the passphrase to a file with mode 0600 (chmod 600 <path>) and pass the path.",
      }
    );
    process.exit(1);
  }

  const passphraseFile = flags["passphrase-file"];
  if (passphraseFile === true) {
    printError("missing_args", "--passphrase-file requires a path argument", {
      example:
        'zerion agent create-token --name <bot> --wallet <wallet> --policy <id> --passphrase-file ~/.zerion-pass',
    });
    process.exit(1);
  }
  if (passphraseFile != null && typeof passphraseFile !== "string") {
    printError("invalid_flag", "--passphrase-file must be a string path", {
      suggestion: "Example: --passphrase-file /run/zerion/pass",
    });
    process.exit(1);
  }
  if (typeof passphraseFile === "string" && passphraseFile.trim() === "") {
    printError("missing_args", "--passphrase-file path cannot be empty", {
      example:
        'zerion agent create-token --name <bot> --wallet <wallet> --policy <id> --passphrase-file ~/.zerion-pass',
    });
    process.exit(1);
  }

  // Resolve policy — from flag or interactive picker
  let policyIds;

  if (flags.policy) {
    // Explicit --policy flag: validate and use
    policyIds = flags.policy.split(",").map((p) => p.trim());
    for (const pid of policyIds) {
      try {
        ows.getPolicy(pid);
      } catch {
        printError("policy_not_found", `Policy "${pid}" not found`, {
          suggestion: "List policies: zerion agent list-policies",
        });
        process.exit(1);
      }
    }
  } else {
    // No --policy flag: launch interactive picker
    const policyId = await pickPolicyInteractive(walletName);
    policyIds = [policyId];
  }

  // Passphrase to prove wallet ownership.
  // Default: interactive TTY prompt (after policy is resolved).
  // Non-interactive: --passphrase-file <path> (validated above; must be mode 0600).
  let passphrase;
  if (passphraseFile) {
    try {
      passphrase = readPassphraseFromFile(passphraseFile);
    } catch (err) {
      printError("passphrase_file_error", err.message, {
        suggestion: "Ensure the file exists, is mode 0600, and contains the passphrase.",
      });
      process.exit(1);
    }
  } else {
    passphrase = await readPassphrase();
  }

  try {
    const result = ows.createAgentToken(name, walletName, passphrase, flags.expires, policyIds);
    saveAgentToken(walletName, result.token);
    setConfigValue("defaultWallet", walletName);

    process.stderr.write(
      "\nAgent token saved to config. All trading commands will use it automatically.\n\n"
    );

    print({
      agentToken: {
        name: result.name,
        wallet: result.wallet,
        policies: policyIds,
        expiresAt: flags.expires || "never",
        saved: true,
      },
      created: true,
    });
  } catch (err) {
    printError("ows_error", `Failed to create agent token: ${err.message}`);
    process.exit(1);
  }
}
