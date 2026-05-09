import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { formatChains } from "../../utils/common/format.js";

export default async function chains(_args, _flags) {
  try {
    const response = await api.getChains();
    const chainList = (response.data || []).map((item) => {
      const attributes = item.attributes || {};
      const flags = attributes.flags || {};
      const id = item.id || "";
      return {
        id,
        name: attributes.name || id || "Unknown",
        supportsTrading: flags.supports_trading ?? false,
        supportsBridge: flags.supports_bridge ?? false,
        supportsSending: flags.supports_sending ?? false,
      };
    });
    chainList.sort((a, b) => a.name.localeCompare(b.name));
    print({ chains: chainList, count: chainList.length }, formatChains);
  } catch (err) {
    printError(err.code || "chains_error", err.message);
    process.exit(1);
  }
}
