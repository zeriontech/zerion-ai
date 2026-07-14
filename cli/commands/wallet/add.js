import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAddress } from "../../utils/wallet/resolve.js";
import { addReadonly, getReadonly } from "../../utils/wallet/readonly.js";

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/**
 * zerion wallet add <address|ens> --name <name>
 *
 * Register a read-only "my wallet": a named address (0x EVM, ENS, or base58
 * Solana) with NO key material. The CLI can build transactions and read
 * on-chain for it, but signing always routes to the web-app handoff (the human
 * connects a wallet controlling this address in the browser). ENS is resolved
 * once, here.
 */
export default async function walletAdd(args, flags) {
  const input = args[0];
  const name = flags.name || args[1];

  if (!input) {
    printError("missing_args", "Usage: zerion wallet add <address|ens> --name <name>", {
      example: "zerion wallet add vitalik.eth --name vitalik",
    });
    process.exit(1);
  }
  if (!name) {
    printError("missing_name", "A --name is required for the read-only wallet.", {
      example: `zerion wallet add ${input} --name my-wallet`,
    });
    process.exit(1);
  }

  // Names live in the same namespace as keystore wallets — refuse collisions so
  // resolveWallet stays unambiguous.
  let keystoreClash = false;
  try {
    ows.getWallet(name);
    keystoreClash = true;
  } catch {
    // not a keystore wallet — good
  }
  if (keystoreClash) {
    printError("name_in_use", `A wallet named "${name}" already exists (keystore).`, {
      suggestion: "Pick a different --name for the read-only wallet.",
    });
    process.exit(1);
  }

  // Resolve to a storable address. Accept a raw EVM address, an ENS name
  // (resolved to 0x here), or a base58 Solana pubkey.
  let address;
  if (EVM_ADDR_RE.test(input)) {
    address = input;
  } else if (SOL_ADDR_RE.test(input)) {
    address = input;
  } else if (input.endsWith(".eth")) {
    try {
      address = await resolveAddress(input);
    } catch (err) {
      printError("ens_resolve_failed", `Could not resolve ENS name "${input}": ${err.message}`);
      process.exit(1);
    }
    if (!EVM_ADDR_RE.test(address)) {
      printError("ens_resolve_failed", `ENS name "${input}" did not resolve to an EVM address.`);
      process.exit(1);
    }
  } else {
    printError("readonly_invalid_address",
      `"${input}" is not a 0x address, ENS name, or Solana pubkey.`,
      { suggestion: "Pass a 0x… address, an ENS name (.eth), or a base58 Solana address." }
    );
    process.exit(1);
  }

  const existing = getReadonly(name);
  try {
    addReadonly(name, address);
  } catch (err) {
    printError("readonly_add_failed", err.message);
    process.exit(1);
  }

  print({
    wallet: {
      name,
      address,
      type: "read-only",
      updated: Boolean(existing),
    },
    note: "Signing for this wallet routes to the Zerion web app for review.",
  });
}
