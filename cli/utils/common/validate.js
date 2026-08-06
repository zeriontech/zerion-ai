/**
 * Input validation for wallet read commands — chain IDs and position filters.
 *
 * `validateChain` is the synchronous, registry-backed check used by analytics
 * commands. Trading commands call `validateTradingChainAsync` instead, which
 * resolves against the live Zerion `/chains/` catalog (so any chain Zerion
 * supports for swap/bridge/send works without a code change here).
 */

import { SUPPORTED_CHAINS, isSolana, toCaip2 } from "../chain/registry.js";
import { resolveChain, listTradingChainIds, listBridgeChainIds, listSendingChainIds } from "../chain/catalog.js";

export const CHAIN_IDS = new Set(SUPPORTED_CHAINS);

export const POSITION_FILTERS = {
  all: "no_filter",
  simple: "only_simple",
  defi: "only_complex",
};

export function validateChain(chain) {
  if (!chain) return null;
  if (chain === true) {
    return {
      code: "missing_chain_value",
      message: "--chain requires a value (e.g. --chain ethereum).",
      supportedChains: Array.from(CHAIN_IDS).sort(),
    };
  }
  if (!CHAIN_IDS.has(chain)) {
    return {
      code: "unsupported_chain",
      message: `Unsupported chain '${chain}'.`,
      supportedChains: Array.from(CHAIN_IDS).sort(),
    };
  }
  return null;
}

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
        suggestion: "Run `zerion chains` for the live list of supported chains and their capabilities.",
      },
    };
  }
  return { caip2: config.caip2 };
}
