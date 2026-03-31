import { listPolicies } from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { formatPolicyRules } from "../../lib/util/format.js";

export default async function agentListPolicies(_args, _flags) {
  try {
    const policies = listPolicies();

    print({
      policies: policies.map((p) => ({
        id: p.id,
        name: p.name,
        rules: formatPolicyRules(p.rules),
        hasExecutable: !!p.executable,
        createdAt: p.created_at,
      })),
      count: policies.length,
    });
  } catch (err) {
    printError("ows_error", `Failed to list policies: ${err.message}`);
    process.exit(1);
  }
}
