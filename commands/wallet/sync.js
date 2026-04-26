import * as ows from "../../lib/wallet/keystore.js";
import { print, printError, isPrettyMode } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";

export default async function walletSync(args, flags) {
  try {
    let wallets;

    if (flags.all) {
      wallets = ows.listWallets();
      if (wallets.length === 0) {
        printError("no_wallets", "No wallets found", {
          suggestion: "Create one first: zerion wallet create",
        });
        process.exit(1);
      }
    } else {
      const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");
      if (!walletName) {
        printError("no_wallet", "No wallet specified", {
          suggestion: "Use --wallet <name>, --all, or set default: zerion config set defaultWallet <name>",
        });
        process.exit(1);
      }
      wallets = [ows.getWallet(walletName)];
    }

    // Collect all addresses
    const addresses = [];
    const walletInfo = [];

    for (const w of wallets) {
      if (w.evmAddress) addresses.push(w.evmAddress);
      if (w.solAddress) addresses.push(w.solAddress);
      walletInfo.push({
        name: w.name,
        evmAddress: w.evmAddress,
        solAddress: w.solAddress,
      });
    }

    const label = wallets.length === 1 ? wallets[0].name : "My Agents";
    const addressList = addresses.join(",");

    const deepLink = `zerion://watchlist/add?addresses=${addressList}&label=${encodeURIComponent(label)}`;
    const webUrl = `https://app.zerion.io/watchlist/add?addresses=${addressList}&label=${encodeURIComponent(label)}`;

    const data = {
      wallets: walletInfo,
      deepLink,
      webUrl,
      addressCount: addresses.length,
    };

    // Pretty mode: show QR code
    if (isPrettyMode()) {
      const qrcode = await import("qrcode-terminal");

      process.stdout.write("\n  Scan with the Zerion app to watch these wallets:\n\n");

      // Generate QR for deep link
      await new Promise((resolve) => {
        qrcode.default.generate(deepLink, { small: true }, (code) => {
          // Indent each line
          const indented = code.split("\n").map((line) => "  " + line).join("\n");
          process.stdout.write(indented + "\n\n");
          resolve();
        });
      });

      process.stdout.write(`  Deep link: ${deepLink}\n`);
      process.stdout.write(`  Web URL:   ${webUrl}\n\n`);

      for (const w of walletInfo) {
        process.stdout.write(`  ${w.name}\n`);
        process.stdout.write(`    EVM: ${w.evmAddress}\n`);
        if (w.solAddress) process.stdout.write(`    SOL: ${w.solAddress}\n`);
      }
      process.stdout.write("\n");
    } else {
      print(data);
    }
  } catch (err) {
    printError("sync_error", `Failed to sync: ${err.message}`);
    process.exit(1);
  }
}
