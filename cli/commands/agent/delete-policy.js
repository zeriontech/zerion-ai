import { deletePolicy } from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";

export default async function agentDeletePolicy(args, flags) {
  const id = flags.id || flags.name || args[0];

  if (!id) {
    printError("missing_args", "Policy ID required", {
      example: "zerion agent delete-policy --id policy-base-only-a1b2c3d4",
    });
    process.exit(1);
  }

  try {
    deletePolicy(id);
    print({ deleted: id, success: true });
  } catch (err) {
    printError("ows_error", `Failed to delete policy: ${err.message}`);
    process.exit(1);
  }
}
