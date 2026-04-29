import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { setConfigValue, getConfigValue } from "../../utils/config.js";
import { readPassphrase, readSecret } from "../../utils/common/prompt.js";
import { PASSPHRASE_WARNING } from "../../utils/common/constants.js";
import { offerAgentToken } from "../../utils/wallet/offer-agent-token.js";
import { offerLogin } from "../../utils/wallet/offer-login.js";

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

    // Offer API key login first — agent tokens / trading / analysis all need one.
    await offerLogin();

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
