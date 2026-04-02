import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue, setConfigValue } from "../../lib/config.js";
import { readPassphrase, readSecret } from "../../lib/util/prompt.js";

export default async function walletDelete(args, flags) {
  // Block in agent mode — agents should not delete wallets
  if (process.env.ZERION_AGENT_TOKEN) {
    printError("agent_blocked", "wallet delete is not available in agent mode", {
      suggestion: "Only the wallet owner can delete wallets interactively",
    });
    process.exit(1);
  }

  // Require interactive terminal
  if (!process.stdin.isTTY) {
    printError("not_interactive", "wallet delete requires an interactive terminal", {
      suggestion: "Run this command directly in your terminal, not from a script or pipe",
    });
    process.exit(1);
  }

  const walletName = flags.wallet || args[0];

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Usage: zerion wallet delete <name>",
    });
    process.exit(1);
  }

  // Verify wallet exists
  let wallet;
  try {
    wallet = ows.getWallet(walletName);
  } catch {
    printError("not_found", `Wallet "${walletName}" not found`, {
      suggestion: "List wallets: zerion wallet list",
    });
    process.exit(1);
  }

  process.stderr.write(
    `\n⚠️  WARNING: This will permanently delete wallet "${wallet.name}".\n` +
    `   Address: ${wallet.evmAddress}\n` +
    `   If you haven't backed up the recovery phrase, all funds will be lost.\n\n`
  );

  try {
    // Require passphrase to prove ownership
    const passphrase = await readPassphrase();

    // Verify passphrase is correct by attempting export
    try {
      ows.exportWallet(walletName, passphrase);
    } catch (err) {
      const code = err.message?.includes("passphrase") || err.message?.includes("decrypt")
        ? "wrong_passphrase" : "ows_error";
      printError(code, code === "wrong_passphrase" ? "Incorrect passphrase" : err.message);
      process.exit(1);
    }

    // Explicit confirmation
    const confirm = await readSecret("Type DELETE to confirm: ");
    if (confirm.trim() !== "DELETE") {
      process.stderr.write("Deletion cancelled.\n");
      process.exit(0);
    }

    ows.deleteWallet(walletName);

    // Clear default wallet if this was it
    if (getConfigValue("defaultWallet") === walletName) {
      setConfigValue("defaultWallet", null);
    }

    print({ deleted: walletName, success: true });
  } catch (err) {
    printError("delete_error", `Failed to delete wallet: ${err.message}`);
    process.exit(1);
  }
}
