import { unsetConfigValue } from "../utils/config.js";
import { print } from "../utils/common/output.js";
import { CONFIG_PATH } from "../utils/common/constants.js";

export default async function logoutCmd() {
  unsetConfigValue("apiKey");
  // Clear agent tokens too — they're tied to this account and won't work after logout.
  unsetConfigValue("agentTokens");
  process.stderr.write(`✓ Logged out successfully\n  Config: ${CONFIG_PATH}\n`);

  // ZERION_API_KEY overrides the saved config, so logout alone doesn't end
  // the session if the user exported it in their shell. Surface it.
  const envKeySet = !!process.env.ZERION_API_KEY;
  if (envKeySet) {
    process.stderr.write(
      "  Note: ZERION_API_KEY is still set in this shell. " +
      "Run `unset ZERION_API_KEY` to fully log out.\n"
    );
  }

  print({ loggedOut: true, config: CONFIG_PATH, envKeySet });
}
