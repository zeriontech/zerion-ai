import { getPolicy } from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { formatPolicyRules, shortenScriptPaths } from "../../lib/util/format.js";

export default async function agentShowPolicy(args, flags) {
  const id = flags.id || flags.name || args[0];

  if (!id) {
    printError("missing_args", "Policy ID or name required", {
      example: "zerion agent show-policy --id policy-base-only-a1b2c3d4",
    });
    process.exit(1);
  }

  try {
    const policy = getPolicy(id);

    const display = {
      ...policy,
      rules: formatPolicyRules(policy.rules),
    };

    if (display.config?.scripts) {
      display.config = {
        ...display.config,
        scripts: shortenScriptPaths(display.config.scripts),
      };
    }

    print({ policy: display });
  } catch (err) {
    printError("ows_error", `Failed to get policy: ${err.message}`);
    process.exit(1);
  }
}
