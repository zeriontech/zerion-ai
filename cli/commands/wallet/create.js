import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { setConfigValue, getConfigValue } from "../../lib/config.js";
import { readPassphrase } from "../../lib/util/prompt.js";

export default async function walletCreate(args, flags) {
  const name = flags.name || args[0] || generateName();

  try {
    // Passphrase is mandatory and must be entered interactively (never via --passphrase flag)
    process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    const passphrase = await readPassphrase({ confirm: true });

    const wallet = ows.createWallet(name, passphrase);

    // Set as default wallet if none exists
    if (!getConfigValue("defaultWallet")) {
      setConfigValue("defaultWallet", name);
    }

    print({
      wallet: {
        name: wallet.name,
        evmAddress: wallet.evmAddress,
        solAddress: wallet.solAddress,
        chains: wallet.chains.length,
      },
      created: true,
      isDefault: getConfigValue("defaultWallet") === name,
    });
  } catch (err) {
    printError("ows_error", `Failed to create wallet: ${err.message}`);
    process.exit(1);
  }
}

function generateName() {
  try {
    const existing = ows.listWallets();
    return `wallet-${existing.length + 1}`;
  } catch {
    return "wallet-1";
  }
}
