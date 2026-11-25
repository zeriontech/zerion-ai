import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAddress } from "../../utils/wallet/resolve.js";
import { getReadonly } from "../../utils/wallet/readonly.js";
import { getWalletOrigin, getWalletAddresses } from "../../utils/config.js";
import { isEvmAddress } from "../../utils/chain/address.js";
import { isSolana } from "../../utils/chain/registry.js";
import { listTradingChainIds, resolveChain } from "../../utils/chain/catalog.js";
import { getPublicClient } from "../../utils/trading/transaction.js";
import { runWithConcurrency } from "../../utils/trading/consolidate.js";
import { addSafe, getSafe } from "../../utils/safe/registry.js";
import { readSafeState, assertSupportedVersion, SUPPORTED_SAFE_VERSIONS } from "../../utils/safe/contracts.js";
import { getSafeChainInfo } from "../../utils/safe/chain-info.js";

const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 10_000;
const USAGE = "zerion wallet add-safe <address> --name <name> --signer <wallet>[,<wallet>…] [--executor <wallet>] [--chains <a,b>]";

function fail(code, message, details) {
  printError(code, message, details);
  process.exit(1);
}

function splitList(value) {
  return typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function isKeystoreWallet(name) {
  try {
    ows.getWallet(name);
    return true;
  } catch {
    return false;
  }
}

function evmAddressOf(walletName) {
  const ro = getReadonly(walletName);
  if (ro) return isEvmAddress(ro.address) ? ro.address : null;
  if (!isKeystoreWallet(walletName)) return null;
  return getWalletAddresses(ows.getWallet(walletName), getWalletOrigin(walletName)).evmAddress || null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: "timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probeChain(chain, safeAddress) {
  const config = await resolveChain(chain);
  if (!config?.chainIdNum) return { chain, skipped: "unsupported_chain" };
  const client = await getPublicClient(chain);
  let state;
  try {
    state = await readSafeState(client, safeAddress);
  } catch (err) {
    if (err.code === "safe_not_deployed") return { chain, skipped: "no_code" };
    throw err;
  }
  try {
    assertSupportedVersion(state.version);
  } catch {
    return { chain, skipped: `version_unsupported:${state.version}` };
  }
  const { txServiceUrl, shortName } = await getSafeChainInfo(config.chainIdNum);
  return {
    chain,
    cache: {
      chainId: config.chainIdNum,
      version: state.version,
      threshold: state.threshold,
      owners: state.owners,
      txService: txServiceUrl,
      appPrefix: shortName,
      refreshedAt: new Date().toISOString(),
    },
  };
}

async function probe(chain, safeAddress) {
  try {
    return await withTimeout(probeChain(chain, safeAddress), PROBE_TIMEOUT_MS);
  } catch (err) {
    process.stderr.write(`Warning: could not read the Safe on ${chain}: ${err.shortMessage || err.message}\n`);
    return { chain, skipped: typeof err.code === "string" ? err.code : "probe_failed" };
  }
}

function noReadableChain(address, skipped) {
  const isNoCode = (s) => s.reason === "no_code";
  const isUnsupported = (s) => s.reason.startsWith("version_unsupported:");
  if (!skipped.every((s) => isNoCode(s) || isUnsupported(s))) {
    return {
      code: "safe_unreadable",
      message: `Could not read the Safe at ${address} on any supported chain (see skipped); nothing saved.`,
    };
  }
  if (skipped.some(isUnsupported)) {
    return {
      code: "safe_version_unsupported",
      message: `The Safe at ${address} has no supported version on any probed chain (supported: ${SUPPORTED_SAFE_VERSIONS.join(", ")}); nothing saved.`,
    };
  }
  return { code: "safe_not_deployed", message: `No contract at ${address} on any probed chain; nothing saved.` };
}

async function targetChains(flags) {
  const requested = splitList(flags.chains);
  if (requested.length > 0) return requested;
  return (await listTradingChainIds()).filter((c) => !isSolana(c));
}

/**
 * zerion wallet add-safe <address> --name <name> --signer <wallet>[,…] [--executor <wallet>] [--chains a,b]
 */
export default async function walletAddSafe(args, flags) {
  const input = args[0];
  const name = typeof flags.name === "string" ? flags.name : undefined;
  const signerNames = splitList(flags.signer);
  const executorName = typeof flags.executor === "string" ? flags.executor : null;

  if (!input) fail("missing_args", `Usage: ${USAGE}`);
  if (!name) fail("missing_name", "A --name is required for the Safe wallet.", { example: USAGE });
  if (signerNames.length === 0) fail("missing_signer", "At least one --signer wallet is required.", { example: USAGE });

  if (isKeystoreWallet(name) || getReadonly(name)) {
    fail("name_in_use", `A wallet named "${name}" already exists.`, {
      suggestion: "Pick a different --name for the Safe wallet.",
    });
  }

  let address;
  if (isEvmAddress(input)) {
    address = input;
  } else if (input.endsWith(".eth")) {
    try {
      address = await resolveAddress(input);
    } catch (err) {
      fail("ens_resolve_failed", `Could not resolve ENS name "${input}": ${err.message}`);
    }
    if (!isEvmAddress(address)) fail("ens_resolve_failed", `ENS name "${input}" did not resolve to an EVM address.`);
  } else {
    fail("safe_invalid_address", `"${input}" is not a 0x address or ENS name.`);
  }

  const existing = getSafe(name);
  if (existing && existing.address.toLowerCase() !== address.toLowerCase()) {
    fail("name_in_use", `A Safe named "${name}" already exists at ${existing.address}.`, {
      suggestion: "Pick a different --name, or re-add that Safe's own address to update it.",
    });
  }

  const signers = signerNames.map((walletName) => ({ walletName, address: evmAddressOf(walletName) }));
  const executorAddress = executorName ? evmAddressOf(executorName) : null;
  const missing = [
    ...signers.filter((s) => !s.address).map((s) => s.walletName),
    ...(executorName && !executorAddress ? [executorName] : []),
  ];
  if (missing.length > 0) {
    fail("wallet_not_found", `Not an EVM keystore or EVM read-only wallet: ${missing.join(", ")}`, {
      suggestion: "List wallets with: zerion wallet list",
    });
  }

  const chainIds = await targetChains(flags);
  const results = await runWithConcurrency(chainIds, PROBE_CONCURRENCY, (chain) => probe(chain, address));

  const chains = {};
  const skipped = [];
  let anySignerOwns = false;
  for (const result of results) {
    if (result.skipped) {
      skipped.push({ chain: result.chain, reason: result.skipped });
      continue;
    }
    chains[result.chain] = result.cache;
    const owners = new Set(result.cache.owners.map((o) => o.toLowerCase()));
    for (const signer of signers) {
      if (owners.has(signer.address.toLowerCase())) {
        anySignerOwns = true;
      } else {
        process.stderr.write(
          `Warning: signer "${signer.walletName}" (${signer.address}) is not an owner of the Safe on ${result.chain}.\n`,
        );
      }
    }
  }

  if (Object.keys(chains).length === 0) {
    const { code, message } = noReadableChain(address, skipped);
    fail(code, message, { skipped });
  }
  if (!anySignerOwns) {
    fail("safe_signer_not_owner", `No --signer is an owner of ${address} on any chain that could be read; nothing saved.`, {
      signers: signers.map((s) => s.address),
      skipped,
    });
  }

  addSafe({ name, address, signers: signerNames, executor: executorName, chains });
  print({ safe: getSafe(name), skipped });
}
