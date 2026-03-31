import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";

export default async function agentRevokeToken(args, flags) {
  const nameOrId = flags.name || flags.id || args[0];

  if (!nameOrId) {
    printError("missing_args", "Token name or ID required", {
      example: "zerion agent revoke-token --name trading-bot",
    });
    process.exit(1);
  }

  try {
    ows.revokeAgentToken(nameOrId);

    print({
      revoked: nameOrId,
      success: true,
    });
  } catch (err) {
    printError("ows_error", `Failed to revoke token: ${err.message}`);
    process.exit(1);
  }
}
