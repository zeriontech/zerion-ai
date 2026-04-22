import { unsetConfigValue, getConfigValue, setConfigValue } from "../lib/config.js";
import { print } from "../lib/util/output.js";

export default async function logoutCmd() {
  unsetConfigValue("apiKey");
  // Clear agent tokens too — they're tied to this account and won't work after logout.
  if (getConfigValue("agentTokens")) {
    setConfigValue("agentTokens", {});
  }
  print({ loggedOut: true });
}
