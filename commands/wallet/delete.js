import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/util/output.js";
import { getConfigValue, setConfigValue, unsetConfigValue, removeAgentTokensForWallet, removeWalletOrigin } from "../../utils/config.js";
import { readPassphrase, readSecret } from "../../utils/util/prompt.js";

export default async function walletDelete(args, flags) {
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

    // Revoke any agent tokens tied to this wallet
    const revokedTokens = revokeWalletTokens(wallet.id);

    // Delete the wallet
    ows.deleteWallet(walletName);

    // Clean up config
    const result = { deleted: walletName, success: true };

    // Clear agent tokens tied to this wallet (also updates activeTokenWallet)
    if (revokedTokens > 0) {
      removeAgentTokensForWallet(walletName);
      result.agentTokenRevoked = true;
    }

    // Clean up wallet origin tracking
    removeWalletOrigin(walletName);

    // Promote another wallet as default if this was the default
    if (getConfigValue("defaultWallet") === walletName) {
      const remaining = ows.listWallets();
      if (remaining.length > 0) {
        const newDefault = remaining[0].name;
        setConfigValue("defaultWallet", newDefault);
        result.newDefaultWallet = newDefault;
        process.stderr.write(`Default wallet changed to "${newDefault}".\n`);
      } else {
        unsetConfigValue("defaultWallet");
        result.newDefaultWallet = null;
      }
    }

    if (revokedTokens > 0) {
      process.stderr.write(
        "Agent token revoked — create a new one for your remaining wallet:\n" +
        "  zerion agent create-token --name <name> --wallet <wallet>\n\n"
      );
    }

    print(result);
  } catch (err) {
    printError("delete_error", `Failed to delete wallet: ${err.message}`);
    process.exit(1);
  }
}

function revokeWalletTokens(walletId) {
  let revoked = 0;
  const tokens = ows.listAgentTokens();
  for (const t of tokens) {
    if (t.walletIds && t.walletIds.includes(walletId)) {
      try {
        ows.revokeAgentToken(t.id);
        revoked++;
      } catch { /* token may already be invalid */ }
    }
  }
  return revoked;
}
