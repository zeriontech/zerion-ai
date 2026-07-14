import * as ows from "../../utils/wallet/keystore.js";
import { printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { readPassphrase } from "../../utils/common/prompt.js";
import { deriveEvmKey, deriveSolanaKey } from "../../utils/wallet/derive-keys.js";
import { isReadonlyWallet } from "../../utils/wallet/readonly.js";

/**
 * zerion wallet export-key --wallet <name> [--chain evm|solana|all] [--index N]
 *
 * Derives raw private keys from the wallet's mnemonic and writes them to
 * stderr (never stdout — same safety stance as `wallet backup`). The OWS
 * vault does not expose private keys directly; we derive them from the
 * mnemonic returned by exportWallet.
 */
export default async function walletExportKey(args, flags) {
  const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  if (isReadonlyWallet(walletName)) {
    printError("readonly_no_keys",
      `Read-only wallet "${walletName}" has no private key to export — it holds no key material.`,
      { suggestion: "Export keys from the original wallet wherever its keys actually live." }
    );
    process.exit(1);
  }

  const chain = (flags.chain || "all").toLowerCase();
  if (!["evm", "solana", "all"].includes(chain)) {
    printError("bad_flag", `Invalid --chain: ${chain}`, {
      suggestion: "Use --chain evm | solana | all",
    });
    process.exit(1);
  }

  const index = flags.index !== undefined ? Number(flags.index) : 0;
  if (!Number.isInteger(index) || index < 0) {
    printError("bad_flag", `Invalid --index: ${flags.index}`, {
      suggestion: "Use a non-negative integer (default 0)",
    });
    process.exit(1);
  }

  process.stderr.write(
    "\n⚠️  WARNING: This will display raw private key(s) derived from your mnemonic.\n" +
    "   Anyone with a private key can drain that account on the matching chain.\n" +
    "   Never share. Never paste into a website. Prefer `wallet backup` (mnemonic).\n\n"
  );

  try {
    const passphrase = await readPassphrase();
    const mnemonic = ows.exportWallet(walletName, passphrase);
    const wallet = ows.getWallet(walletName);

    process.stderr.write(`\n  Wallet:   ${wallet.name}\n`);
    process.stderr.write(`  Path idx: ${index}\n\n`);

    if (chain === "evm" || chain === "all") {
      const evm = deriveEvmKey(mnemonic, index);
      process.stderr.write(`  EVM\n`);
      process.stderr.write(`    address:     ${wallet.evmAddress}\n`);
      process.stderr.write(`    path:        ${evm.path}\n`);
      process.stderr.write(`    private key: ${evm.privateKey}\n\n`);
    }

    if (chain === "solana" || chain === "all") {
      const sol = deriveSolanaKey(mnemonic, index);
      process.stderr.write(`  Solana\n`);
      process.stderr.write(`    address:     ${sol.address}\n`);
      process.stderr.write(`    path:        ${sol.path}\n`);
      process.stderr.write(`    secret key:  ${sol.privateKeyBase58}\n`);
      process.stderr.write(`      (base58, 64-byte Phantom keypair format)\n`);
      process.stderr.write(`    seed (hex):  ${sol.privateKeyHex}\n`);
      process.stderr.write(`      (32-byte ed25519 seed)\n\n`);
    }

    process.stderr.write("  ⚠️  Treat each line above as fully sensitive. Wipe scrollback.\n\n");
  } catch (err) {
    printError("ows_error", `Failed to export private key: ${err.message}`, {
      suggestion: "Check wallet name and passphrase. List wallets: zerion wallet list",
    });
    process.exit(1);
  }
}
