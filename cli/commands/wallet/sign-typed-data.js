import { readFileSync } from "node:fs";
import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { requireAgentToken } from "../../utils/trading/guards.js";
import { toCaip2, SUPPORTED_CHAINS } from "../../utils/chain/registry.js";

/**
 * Read EIP-712 typed data JSON from one of: --data '<json>', --file <path>, or stdin.
 */
async function resolveTypedData(flags, args) {
  if (flags.data) return String(flags.data);
  if (flags.file) return readFileSync(flags.file, "utf8");
  if (args[0] && (args[0].startsWith("{") || args[0].startsWith("["))) return args[0];

  // Fall back to stdin when piped — avoids blocking on interactive TTY
  if (!process.stdin.isTTY) {
    return await readStdin();
  }
  return null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export default async function walletSignTypedData(args, flags) {
  const walletName = flags.wallet || getConfigValue("defaultWallet");
  const chain = flags.chain || getConfigValue("defaultChain") || "ethereum";

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  if (chain === "solana") {
    printError("evm_only", "EIP-712 typed data signing is EVM-only", {
      suggestion: "Use `zerion wallet sign-message --chain solana` for Solana message signing",
    });
    process.exit(1);
  }

  if (!SUPPORTED_CHAINS.includes(chain)) {
    printError("invalid_chain", `Unsupported chain "${chain}"`, {
      suggestion: `Supported: ${SUPPORTED_CHAINS.filter((c) => c !== "solana").join(", ")}`,
    });
    process.exit(1);
  }

  const typedDataJson = await resolveTypedData(flags, args);
  if (!typedDataJson || !typedDataJson.trim()) {
    printError("no_typed_data", "No typed data provided", {
      suggestion: "Provide --data '<json>', --file <path>, or pipe JSON to stdin",
    });
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(typedDataJson);
  } catch (err) {
    printError("invalid_json", `Invalid typed data JSON: ${err.message}`, {
      suggestion: 'Must be a JSON object with { domain, types, primaryType, message }',
    });
    process.exit(1);
  }

  if (!parsed || typeof parsed !== "object" || !parsed.domain || !parsed.types || !parsed.primaryType || !parsed.message) {
    printError("invalid_typed_data", "Typed data missing required fields", {
      suggestion: "Expected { domain, types, primaryType, message }",
    });
    process.exit(1);
  }

  // Validate the wallet exists BEFORE prompting for agent-token setup, so a
  // typo'd --wallet doesn't drag the user through token creation just to fail.
  let wallet;
  try {
    wallet = ows.getWallet(walletName);
  } catch (err) {
    printError("wallet_not_found", `Wallet "${walletName}" not found`, {
      suggestion: "List wallets: zerion wallet list",
    });
    process.exit(1);
  }

  // Agent token required — same model as swap/bridge/send. No interactive passphrase.
  const passphrase = await requireAgentToken("for signing", walletName);

  try {
    const caip2 = toCaip2(chain);

    // Re-serialize to normalize whitespace before handing to OWS
    const canonical = JSON.stringify(parsed);
    const result = ows.signTypedData(walletName, canonical, passphrase, caip2);

    print({
      wallet: wallet.name,
      address: wallet.evmAddress,
      chain,
      primaryType: parsed.primaryType,
      domain: parsed.domain,
      signature: result.signature,
      ...(result.recoveryId != null ? { recoveryId: result.recoveryId } : {}),
    });
  } catch (err) {
    if (err.message?.includes("API key not found")) {
      printError("invalid_agent_token", "Agent token is revoked or invalid", {
        suggestion: "Create a new one: zerion agent create-token --name <name> --wallet <wallet>",
      });
    } else {
      printError(err.code || "sign_error", `Failed to sign typed data: ${err.message}`);
    }
    process.exit(1);
  }
}
