import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { setConfigValue, getConfigValue, setWalletOrigin, getWalletAddresses } from "../../utils/config.js";
import { readSecret, readPassphrase } from "../../utils/common/prompt.js";
import { offerAgentToken } from "../../utils/wallet/offer-agent-token.js";
import { offerLogin } from "../../utils/wallet/offer-login.js";
import { WALLET_ORIGIN, PASSPHRASE_WARNING } from "../../utils/common/constants.js";

export default async function walletImport(args, flags) {
  const name = flags.name || args[0] || `imported-${Date.now()}`;

  const hasEvmKey = !!flags["evm-key"];
  const hasSolKey = !!flags["sol-key"];
  const hasMnemonic = !!flags.mnemonic;
  const inputCount = [hasEvmKey, hasSolKey, hasMnemonic].filter(Boolean).length;

  if (inputCount === 0) {
    printError(
      "missing_input",
      "Provide --evm-key, --sol-key, or --mnemonic",
      { suggestion: "zerion wallet import --evm-key      # EVM private key (interactive)\nzerion wallet import --sol-key      # Solana private key (interactive)\nzerion wallet import --mnemonic     # Seed phrase (interactive)" }
    );
    process.exit(1);
  }

  if (inputCount > 1) {
    printError("invalid_input", "Provide only one of --evm-key, --sol-key, or --mnemonic");
    process.exit(1);
  }

  try {
    process.stderr.write("A passphrase is required to encrypt your wallet.\n\n");
    const passphrase = await readPassphrase({ confirm: true });
    process.stderr.write(PASSPHRASE_WARNING);

    let wallet;
    let origin;

    if (hasEvmKey) {
      const key = await readSecret("Enter EVM private key (hex): ");
      wallet = ows.importFromKey(name, key, passphrase, "evm");
      origin = WALLET_ORIGIN.EVM_KEY;
    } else if (hasSolKey) {
      const key = await readSecret("Enter Solana private key (base58, hex, or byte array): ");
      wallet = ows.importFromKey(name, key, passphrase, "solana");
      origin = WALLET_ORIGIN.SOL_KEY;
    } else {
      const mnemonic = await readSecret("Enter mnemonic phrase: ");
      wallet = ows.importFromMnemonic(name, mnemonic, passphrase);
      origin = WALLET_ORIGIN.MNEMONIC;
    }

    setWalletOrigin(name, origin);

    if (!getConfigValue("defaultWallet")) {
      setConfigValue("defaultWallet", name);
    }

    print({
      wallet: { name: wallet.name, ...getWalletAddresses(wallet, origin) },
      imported: true,
    });

    await offerLogin();
    await offerAgentToken(name, passphrase);
  } catch (err) {
    printError("ows_error", `Failed to import wallet: ${err.message}`);
    process.exit(1);
  }
}
