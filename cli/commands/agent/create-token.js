import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue, setConfigValue } from "../../lib/config.js";
import { readPassphrase } from "../../lib/util/prompt.js";
import { pickPolicyInteractive } from "../../lib/wallet/policy-picker.js";

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

  // Passphrase to prove wallet ownership — always interactive (after policy is resolved)
  const passphrase = await readPassphrase();

  try {
    const result = ows.createAgentToken(name, walletName, passphrase, flags.expires, policyIds);
    setConfigValue("agentToken", result.token);

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
