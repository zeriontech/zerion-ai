import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";
import { readPassphrase } from "../../lib/util/prompt.js";

export default async function agentCreateToken(args, flags) {
  const name = flags.name || args[0];
  const walletName = flags.wallet || getConfigValue("defaultWallet");

  if (!name) {
    printError("missing_args", "Token name required", {
      example: 'zerion-cli agent create-token --name "trading-bot" --wallet my-agent --policy <policy-id>',
    });
    process.exit(1);
  }

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion-cli config set defaultWallet <name>",
    });
    process.exit(1);
  }

  // Require interactive passphrase to prove wallet ownership — never accept via flag
  const passphrase = await readPassphrase();

  // Resolve policy IDs
  const policyIds = flags.policy
    ? flags.policy.split(",").map((p) => p.trim())
    : [];

  // Validate policies exist
  for (const pid of policyIds) {
    try {
      ows.getPolicy(pid);
    } catch {
      printError("policy_not_found", `Policy "${pid}" not found`, {
        suggestion: "List policies: zerion-cli agent list-policies",
      });
      process.exit(1);
    }
  }

  try {
    const result = ows.createAgentToken(name, walletName, passphrase, flags.expires, policyIds);

    process.stderr.write(
      "\n⚠️  Save this token now — it will NOT be shown again.\n" +
      "   Use it as: ZERION_AGENT_TOKEN=<token> zerion-cli swap ...\n\n"
    );

    print({
      agentToken: {
        name: result.name,
        token: result.token,
        wallet: result.wallet,
        policies: policyIds.length > 0 ? policyIds : "none",
        expiresAt: flags.expires || "never",
      },
      created: true,
    });
  } catch (err) {
    printError("ows_error", `Failed to create agent token: ${err.message}`);
    process.exit(1);
  }
}
