import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { setConfigValue, getConfigValue } from "../../lib/config.js";
import { readPassphrase, readSecret } from "../../lib/util/prompt.js";
import { PASSPHRASE_WARNING } from "../../lib/util/constants.js";
import { offerAgentToken } from "../../lib/wallet/offer-agent-token.js";

export default async function walletCreate(args, flags) {
  const name = flags.name || args[0] || generateName();

  try {
    process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    const passphrase = await readPassphrase({ confirm: true });

    process.stderr.write(PASSPHRASE_WARNING);

    let ack = "";
    while (ack.trim() !== "YES") {
      ack = await readSecret("Have you backed up the passphrase? Type YES to confirm: ");
      if (ack.trim() !== "YES") {
        process.stderr.write("Please back up your passphrase before continuing.\n\n");
      }
    }

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

    // Offer agent token creation as part of wallet setup
    await offerAgentToken(name, passphrase);
  } catch (err) {
    printError("ows_error", `Failed to create wallet: ${err.message}`);
    process.exit(1);
  }
}

function generateName() {
  try {
    const existing = ows.listWallets();
    return `wallet-${existing.length + 1}`;
  } catch (err) {
    process.stderr.write(`Warning: could not list wallets: ${err.message}\n`);
    return "wallet-1";
  }
}
