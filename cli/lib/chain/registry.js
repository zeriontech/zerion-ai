/**
 * EVM chain registry — maps Zerion chain IDs to viem chain configs.
 */

import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  gnosis,
  scroll,
  linea,
  zkSync,
  zora,
  blast,
} from "viem/chains";

const CHAIN_MAP = new Map([
  ["ethereum", { viemChain: mainnet, name: "Ethereum", nativeCurrency: "ETH" }],
  ["base", { viemChain: base, name: "Base", nativeCurrency: "ETH" }],
  ["arbitrum", { viemChain: arbitrum, name: "Arbitrum", nativeCurrency: "ETH" }],
  ["optimism", { viemChain: optimism, name: "Optimism", nativeCurrency: "ETH" }],
  ["polygon", { viemChain: polygon, name: "Polygon", nativeCurrency: "POL" }],
  ["binance-smart-chain", { viemChain: bsc, name: "BNB Chain", nativeCurrency: "BNB" }],
  ["avalanche", { viemChain: avalanche, name: "Avalanche", nativeCurrency: "AVAX" }],
  ["gnosis", { viemChain: gnosis, name: "Gnosis", nativeCurrency: "xDAI" }],
  ["scroll", { viemChain: scroll, name: "Scroll", nativeCurrency: "ETH" }],
  ["linea", { viemChain: linea, name: "Linea", nativeCurrency: "ETH" }],
  ["zksync-era", { viemChain: zkSync, name: "zkSync Era", nativeCurrency: "ETH" }],
  ["zora", { viemChain: zora, name: "Zora", nativeCurrency: "ETH" }],
  ["blast", { viemChain: blast, name: "Blast", nativeCurrency: "ETH" }],
]);

// Solana (not in CHAIN_MAP since it uses different infra)
const SOLANA_CHAIN = {
  name: "Solana",
  nativeCurrency: "SOL",
  rpcUrl: "https://api.mainnet-beta.solana.com",
};

export const SUPPORTED_CHAINS = [...CHAIN_MAP.keys(), "solana"];

// CAIP-2 identifiers derived from viem chain IDs — single source of truth
export const CAIP2_MAP = new Map([
  ...Array.from(CHAIN_MAP.entries()).map(([name, info]) => [name, `eip155:${info.viemChain.id}`]),
  ["solana", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
]);

const CAIP2_REVERSE = new Map([...CAIP2_MAP.entries()].map(([k, v]) => [v, k]));

export function toCaip2(chainName) {
  return CAIP2_MAP.get(chainName) || chainName;
}

export function fromCaip2(caip2) {
  return CAIP2_REVERSE.get(caip2) || caip2;
}

export function isSolana(chainId) {
  return chainId === "solana";
}

export function getSolanaRpcUrl() {
  return process.env.SOLANA_RPC_URL || SOLANA_CHAIN.rpcUrl;
}

export function getChain(zerionId) {
  if (zerionId === "solana") return SOLANA_CHAIN;
  return CHAIN_MAP.get(zerionId) || null;
}

export function getViemChain(zerionId) {
  const chain = CHAIN_MAP.get(zerionId);
  return chain ? chain.viemChain : null;
}

export function validateChain(zerionId) {
  if (CHAIN_MAP.has(zerionId)) return null;
  return {
    code: "chain_not_supported",
    message: `Chain "${zerionId}" is not supported`,
    supportedChains: SUPPORTED_CHAINS,
  };
}
