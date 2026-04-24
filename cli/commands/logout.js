import { unsetConfigValue } from "../lib/config.js";
import { print } from "../lib/util/output.js";
import { CONFIG_PATH } from "../lib/util/constants.js";

export default async function logoutCmd() {
  unsetConfigValue("apiKey");
  // Clear agent tokens too — they're tied to this account and won't work after logout.
  unsetConfigValue("agentTokens");
  process.stderr.write(`✓ Logged out successfully\n  Config: ${CONFIG_PATH}\n`);
  print({ loggedOut: true, config: CONFIG_PATH });
}
