import * as ows from "../../lib/wallet/keystore.js";
import { printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";
import { readPassphrase } from "../../lib/util/prompt.js";

export default async function walletBackup(args, flags) {
  const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  // Security warning
  process.stderr.write(
    "\n⚠️  WARNING: This will display your recovery phrase.\n" +
    "   Anyone with this phrase can control all funds in this wallet.\n" +
    "   Never share it. Never paste it into a website.\n\n"
  );

  try {
    // Always prompt for passphrase interactively — never accept from flags
    const passphrase = await readPassphrase();

    const mnemonic = ows.exportWallet(walletName, passphrase);
    const wallet = ows.getWallet(walletName);

    // Write mnemonic to stderr only — keeps it off stdout so pipes/logs never capture it
    process.stderr.write(`\n  Wallet:   ${wallet.name}\n`);
    process.stderr.write(`  Address:  ${wallet.evmAddress}\n\n`);
    process.stderr.write(`  ${mnemonic}\n\n`);
    process.stderr.write("  ⚠️  Write this down and store it offline. It will not be shown again.\n\n");
  } catch (err) {
    printError("ows_error", `Failed to backup wallet: ${err.message}`, {
      suggestion: "Check wallet name and passphrase. List wallets: zerion wallet list",
    });
    process.exit(1);
  }
}
