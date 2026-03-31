/**
 * Input validation for wallet read commands — chain IDs and position filters.
 */

import { SUPPORTED_CHAINS } from "../chain/registry.js";

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
