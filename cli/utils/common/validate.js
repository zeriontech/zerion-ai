/**
 * Input validation for wallet read commands — chain IDs and position filters.
 *
 * Every chain guard here resolves against the live Zerion `/chains/` catalog
 * rather than the static 14-chain registry, so any chain Zerion knows works
 * without a code change: `validateTradingChainAsync` for swap/bridge/send (which
 * also checks capability flags), `resolveSigningChainAsync` for off-chain
 * signing, and `resolveReadChainAsync` for `--chain` filters on read commands.
 */

import { isSolana, toCaip2 } from "../chain/registry.js";
import { isSolanaAddress } from "../chain/address.js";
import { resolveChain, listTradingChainIds, listBridgeChainIds, listSendingChainIds } from "../chain/catalog.js";

const CHAINS_HINT = "Run `zerion chains` for the live list of supported chains and their capabilities.";

export const POSITION_FILTERS = {
  all: "no_filter",
  simple: "only_simple",
  defi: "only_complex",
};

export function validatePositions(flag) {
  if (!flag) return null;
  if (flag === true) {
    return {
      code: "missing_positions_value",
      message: "--positions requires a value (e.g. --positions all).",
      supportedValues: Object.keys(POSITION_FILTERS),
    };
  }
  if (!POSITION_FILTERS[flag]) {
    return {
      code: "unsupported_positions_filter",
      message: `Unsupported positions filter '${flag}'.`,
      supportedValues: Object.keys(POSITION_FILTERS),
    };
  }
  return null;
}

export function resolvePositionFilter(flag) {
  return POSITION_FILTERS[flag] || "no_filter";
}

/**
 * Pick the `filter[positions]` value to send for one specific address.
 *
 * The Zerion API has no protocol (DeFi) positions for Solana yet, and
 * `/positions/` hard-rejects both `no_filter` and `only_complex` for base58
 * addresses with a 400 ("currently not supported for Solana addresses").
 * `only_simple` is the only value it accepts. EVM addresses take all three.
 *
 * So on Solana:
 *   - `--positions defi` / `--defi` asks for something that cannot exist —
 *     a structured error beats silently handing back token holdings.
 *   - `all` or unset already means "everything there is", and on Solana that
 *     *is* the simple set — downgrade quietly but say so in the output.
 *   - `simple` is already the only supported value.
 *
 * Returns `{ filter, note }` or `{ error }` — exactly one of filter/error set.
 */
export function resolvePositionFilterForAddress(address, flag) {
  const filter = resolvePositionFilter(flag);
  if (!isSolanaAddress(address) || filter === "only_simple") return { filter };

  if (filter === "only_complex") {
    return {
      error: {
        code: "solana_defi_unsupported",
        message:
          "Solana addresses have no DeFi positions in the Zerion API yet, " +
          "so there is nothing for --positions defi to return.",
        suggestion:
          "Drop --defi/--positions defi to see token holdings, or query an EVM address.",
      },
    };
  }

  return {
    filter: "only_simple",
    note: "Solana has no DeFi positions in the Zerion API yet — showing token holdings only.",
  };
}

const TRADING_CAPABILITIES = {
  trade: { flag: "supportsTrading", lister: listTradingChainIds, label: "trading" },
  bridge: { flag: "supportsBridge", lister: listBridgeChainIds, label: "bridging" },
  send: { flag: "supportsSending", lister: listSendingChainIds, label: "sending" },
};

// Resolve a trading chain against the live API catalog. Returns
// `{ error, config }` — at most one is set. `kind` is "trade" | "bridge" | "send".
export async function validateTradingChainAsync(chain, kind = "trade") {
  if (!chain) return { config: null };
  if (chain === true) {
    return {
      error: {
        code: "missing_chain_value",
        message: "--chain requires a value (e.g. --chain ethereum).",
        supportedChains: await TRADING_CAPABILITIES[kind].lister(),
      },
    };
  }

  const config = await resolveChain(chain);
  if (!config) {
    return {
      error: {
        code: "unsupported_chain",
        message: `Unsupported chain '${chain}'.`,
        supportedChains: await TRADING_CAPABILITIES[kind].lister(),
      },
    };
  }

  const cap = TRADING_CAPABILITIES[kind];
  if (!config.flags[cap.flag]) {
    return {
      error: {
        code: "chain_capability_missing",
        message: `Chain '${chain}' does not support ${cap.label} on Zerion.`,
        supportedChains: await cap.lister(),
      },
    };
  }

  if (!config.viemChain || !config.chainIdNum) {
    return {
      error: {
        code: "chain_unsignable",
        message: `Chain '${chain}' is missing the metadata needed to sign transactions (no EVM chain ID).`,
      },
    };
  }

  return { config };
}

// Resolve a chain to its CAIP-2 id for off-chain signing (EIP-191 personal_sign
// / EIP-712 typed data), validating against the live `/chains/` catalog rather
// than the static registry — so any chain Zerion knows can be signed for
// without a code change here. Off-chain signing needs no trading/bridge/send
// capability, only a known chain that carries a CAIP-2, so this deliberately
// does NOT check capability flags. Solana keeps its static ed25519 network id
// (it has no eip155 id in the EVM catalog). Returns `{ error, caip2 }` — exactly
// one is set.
export async function resolveSigningChainAsync(chain) {
  if (!chain) return { caip2: null };
  if (isSolana(chain)) return { caip2: toCaip2("solana") };

  const config = await resolveChain(chain);
  if (!config || !config.caip2) {
    return {
      error: {
        code: "unsupported_chain",
        message: `Unsupported chain '${chain}'.`,
        suggestion: CHAINS_HINT,
      },
    };
  }
  return { caip2: config.caip2 };
}

// Validate a `--chain` filter on a read command (positions, analyze, …) against
// the live `/chains/` catalog. Reads need no trading/bridge/send capability —
// anything Zerion indexes can be filtered on — so this only checks that the
// chain is known, and it deliberately does NOT require a CAIP-2 or EVM chain ID
// (nothing is signed here, and non-EVM chains like Solana carry neither).
// Returns `{ error, chainId }` — exactly one is set. A falsy chain means "no
// filter" and resolves to `{ chainId: null }` without touching the network.
export async function resolveReadChainAsync(chain) {
  if (!chain) return { chainId: null };
  if (chain === true) {
    return {
      error: {
        code: "missing_chain_value",
        message: "--chain requires a value (e.g. --chain ethereum).",
        suggestion: CHAINS_HINT,
      },
    };
  }

  const config = await resolveChain(chain);
  if (!config) {
    return {
      error: {
        code: "unsupported_chain",
        message: `Unsupported chain '${chain}'.`,
        suggestion: CHAINS_HINT,
      },
    };
  }
  return { chainId: config.id };
}
