/**
 * Post-wallet-creation flow: auto-create an agent token WITH a required policy.
 * Used by both `wallet create` and `wallet import`.
 *
 * Delegates to the shared policy picker for interactive tier/expiry/chain selection.
 */

import * as ows from "./keystore.js";
import { print } from "../util/output.js";
import { setConfigValue } from "../config.js";
import { pickPolicyInteractive } from "./policy-picker.js";

/**
 * Auto-create an agent token with a mandatory policy for the given wallet.
 */
export async function offerAgentToken(walletName, passphrase) {
  const policyId = await pickPolicyInteractive(walletName);

  try {
    const result = ows.createAgentToken(
      `${walletName}-agent`, walletName, passphrase, undefined, [policyId]
    );
    setConfigValue("agentToken", result.token);

    print({
      agentToken: {
        name: result.name,
        wallet: walletName,
        policy: policyId,
        saved: true,
      },
      created: true,
    });
  } catch (err) {
    process.stderr.write(`Warning: could not create agent token: ${err.message}\n\n`);
  }
}
