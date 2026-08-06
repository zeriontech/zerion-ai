import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { requireAgentToken, parseTimeout } from "../../utils/trading/guards.js";
import { getReadonly } from "../../utils/wallet/readonly.js";
import { decideMessageSigningRoute } from "../../utils/trading/signing-route.js";
import { getPublicClient } from "../../utils/trading/transaction.js";
import {
  toPersonalSignRequest,
  toSolanaMessageRequest,
  signMessageViaWebApp,
  reportMessageHandoff,
} from "../../utils/web-app/handoff.js";
import { solanaMessageVerifier } from "../../utils/chain/solana-handoff.js";
import { isSolana } from "../../utils/chain/registry.js";
import { resolveSigningChainAsync } from "../../utils/common/validate.js";

export default async function walletSignMessage(args, flags) {
  const walletName = flags.wallet || getConfigValue("defaultWallet");
  const chain = flags.chain || getConfigValue("defaultChain") || "ethereum";
  const encoding = flags.encoding || "utf8";
  const message = flags.message ?? args[0];

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  if (message == null || message === "") {
    printError("no_message", "No message provided", {
      suggestion: "Pass the message as the first argument or --message <text>",
    });
    process.exit(1);
  }

  if (encoding !== "utf8" && encoding !== "hex") {
    printError("invalid_encoding", `Invalid --encoding "${encoding}"`, {
      suggestion: 'Use "utf8" or "hex"',
    });
    process.exit(1);
  }

  // Validate against the live catalog (not the static 14-chain registry) so any
  // chain Zerion supports can be signed for. `caip2` is reused at signing time.
  const chainCheck = await resolveSigningChainAsync(chain);
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      suggestion: chainCheck.error.suggestion,
    });
    process.exit(1);
  }
  const caip2 = chainCheck.caip2;

  // Resolve the wallet BEFORE prompting for agent-token setup, so a typo'd
  // --wallet doesn't drag the user through token creation just to fail.
  // Read-only wallets live in their own registry (no keystore entry).
  const readonly = getReadonly(walletName);
  let wallet = null;
  if (!readonly) {
    try {
      wallet = ows.getWallet(walletName);
    } catch (err) {
      printError("wallet_not_found", `Wallet "${walletName}" not found`, {
        suggestion: "List wallets: zerion wallet list",
      });
      process.exit(1);
    }
  }

  const { route, reason } = decideMessageSigningRoute({ walletName, force: flags.review });
  process.stderr.write(`Signing route: ${route} — ${reason}.\n`);

  if (route === "web-app") {
    // Signer address: read-only wallets carry it directly (EVM or Solana);
    // keystore wallets pick the account matching the chain.
    const address = readonly
      ? readonly.address
      : (isSolana(chain) ? wallet.solAddress : wallet.evmAddress);
    if (!address) {
      printError("no_account_for_chain",
        `Wallet "${walletName}" has no ${isSolana(chain) ? "Solana" : "EVM"} account.`,
        { suggestion: isSolana(chain) ? "Use a wallet with a Solana account." : "Use a wallet with an EVM account." }
      );
      process.exit(1);
    }
    return signMessageOnWebApp({ address, walletName, chain, encoding, message, flags });
  }

  // Local route — unlock the keystore and sign with OWS.
  // Agent token required — same model as swap/bridge/send. No interactive passphrase.
  const passphrase = await requireAgentToken("for signing", walletName);

  try {
    const result = ows.signMessage(walletName, message, passphrase, encoding, caip2);

    print({
      wallet: wallet.name,
      address: isSolana(chain) ? wallet.solAddress : wallet.evmAddress,
      chain,
      encoding,
      message,
      signedVia: "local",
      signature: result.signature,
      ...(result.recoveryId != null ? { recoveryId: result.recoveryId } : {}),
    });
  } catch (err) {
    if (err.message?.includes("API key not found")) {
      printError("invalid_agent_token", "Agent token is revoked or invalid", {
        suggestion: "Create a new one: zerion agent create-token --name <name> --wallet <wallet>",
      });
    } else {
      printError(err.code || "sign_error", `Failed to sign message: ${err.message}`);
    }
    process.exit(1);
  }
}

// Web-app route: build the message request (EIP-191 for EVM, raw ed25519 for
// Solana), open the /cli/message link, wait for the callback, and verify the
// returned signature against the signer address.
async function signMessageOnWebApp({ address, walletName, chain, encoding, message, flags }) {
  const solana = isSolana(chain);

  // Best-effort verifier client. EVM: a viem public client (also supplies a
  // display chain id, verifies EOA + ERC-1271). Solana: an ed25519 verifier.
  // Without a verifier the handoff still works — the signature is just reported
  // unverified.
  let client = null;
  if (solana) {
    client = solanaMessageVerifier();
  } else {
    try {
      client = await getPublicClient(chain);
    } catch (err) {
      process.stderr.write(
        `Warning: could not get an RPC client for ${chain} (${err.message?.split("\n")[0]}) — ` +
        `the returned signature will not be verified.\n`
      );
    }
  }

  let request;
  try {
    request = solana
      ? toSolanaMessageRequest({ message, encoding })
      : toPersonalSignRequest({ message, encoding, chainIdNum: client?.chain?.id });
  } catch (err) {
    printError("invalid_message", err.message, {
      suggestion: 'With --encoding hex, pass hex bytes like "0xdeadbeef"',
    });
    process.exit(1);
  }

  const result = await signMessageViaWebApp({
    address,
    message: request,
    timeout: parseTimeout(flags.timeout),
    client,
  });

  reportMessageHandoff(
    { wallet: walletName, address, chain, encoding, message },
    result
  );
}
