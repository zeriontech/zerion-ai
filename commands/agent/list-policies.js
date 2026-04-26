import { listPolicies } from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { formatPolicyRules } from "../../utils/common/format.js";

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
