/**
 * wallet positions — token holdings and DeFi positions with filtering.
 * Supports --positions all|simple|defi, --defi shorthand, and --chain filtering.
 *
 * --defi enables a richer DeFi-aware response that groups positions by dapp
 * (Aave, Uniswap, Lido, etc.) and collapses LP tokens that share a `group_id`
 * into a single pool entry. Loans are netted against deposits in the protocol
 * total (loan value enters the sum negatively).
 */

import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import { resolveReadChainAsync, resolvePositionsFlag, resolvePositionFilterForAddress } from "../../utils/common/validate.js";
import { resolveAuth } from "../../utils/api/auth.js";
import { formatPositions, formatDefiPositions } from "../../utils/common/format.js";

export default async function walletPositions(args, flags) {
  // Validate against the live catalog (not the static 14-chain registry) so any
  // chain Zerion indexes can be filtered on.
  const chainCheck = await resolveReadChainAsync(flags.chain);
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      suggestion: chainCheck.error.suggestion,
    });
    process.exit(1);
  }
  const chainId = chainCheck.chainId;

  // --defi is shorthand for --positions defi + DeFi-grouped output. The flag
  // normalisation is shared with `analyze`, which accepts the same two flags.
  const positionsFlag = resolvePositionsFlag(flags);
  if (positionsFlag.error) {
    const { code, message, ...details } = positionsFlag.error;
    printError(code, message, details);
    process.exit(1);
  }
  const { value: positionsValue, defiMode } = positionsFlag;

  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  // Solana takes only `only_simple` on this endpoint — downgrade an implicit
  // "everything", but refuse an explicit DeFi ask rather than quietly handing
  // back token holdings that were never what was requested.
  const filterCheck = resolvePositionFilterForAddress(address, positionsValue);
  if (filterCheck.error) {
    printError(filterCheck.error.code, filterCheck.error.message, {
      suggestion: filterCheck.error.suggestion,
    });
    process.exit(1);
  }

  try {
    const auth = resolveAuth(flags);
    const response = await api.getPositions(address, {
      chainId,
      positionFilter: filterCheck.filter,
      auth,
    });

    if (defiMode) {
      const enriched = (response.data || [])
        .map(toDefiPosition)
        .filter((p) => p.value > 0);
      const protocols = groupByDapp(enriched);
      print({
        wallet: { name: walletName, address },
        filter: "defi",
        chain: chainId,
        summary: {
          total_value: netValue(enriched),
          gross_value: enriched.reduce((s, p) => s + (p.value || 0), 0),
          protocols: protocols.length,
          positions: enriched.length,
        },
        protocols,
      }, formatDefiPositions);
      return;
    }

    const positions = (response.data || [])
      .map((p) => ({
        name: p.attributes.fungible_info?.name ?? p.attributes.name ?? "Unknown",
        symbol: p.attributes.fungible_info?.symbol ?? null,
        chain: p.relationships?.chain?.data?.id ?? null,
        quantity: p.attributes.quantity?.float ?? null,
        value: p.attributes.value ?? 0,
        price: p.attributes.price ?? null,
        change_absolute_1d: p.attributes.changes?.absolute_1d ?? null,
        change_percent_1d: p.attributes.changes?.percent_1d ?? null,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    const payload = {
      wallet: { name: walletName, address },
      positions,
      count: positions.length,
      filter: positionsValue || "all",
    };
    if (filterCheck.note) payload.notes = [filterCheck.note];
    print(payload, formatPositions);
  } catch (err) {
    printError(err.code || "positions_error", err.message);
    process.exit(1);
  }
}

function toDefiPosition(p) {
  const a = p.attributes || {};
  return {
    name: a.fungible_info?.name ?? a.name ?? "Unknown",
    symbol: a.fungible_info?.symbol ?? null,
    chain: p.relationships?.chain?.data?.id ?? null,
    quantity: a.quantity?.float ?? null,
    value: a.value ?? 0,
    price: a.price ?? null,
    change_percent_1d: a.changes?.percent_1d ?? null,
    protocol: a.protocol ?? null,
    protocol_module: a.protocol_module ?? null,
    position_type: a.position_type ?? null,
    group_id: a.group_id ?? null,
    pool_address: a.pool_address ?? null,
    dapp: {
      id: p.relationships?.dapp?.data?.id ?? null,
      name: a.application_metadata?.name ?? null,
      url: a.application_metadata?.url ?? null,
    },
  };
}

// Sign a position's value: loans are debt, everything else is asset.
function signedValue(p) {
  return p.position_type === "loan" ? -p.value : p.value;
}

function netValue(positions) {
  return positions.reduce((sum, p) => sum + signedValue(p), 0);
}

// Group flat positions into protocol → group_id → tokens. The API returns one
// row per token even within a single Uniswap pool, so positions that share
// `group_id` belong to the same pool and should render together.
function groupByDapp(positions) {
  const byDapp = new Map();
  for (const p of positions) {
    const dappKey = p.dapp?.name || p.protocol || p.protocol_module || "Other";
    if (!byDapp.has(dappKey)) {
      byDapp.set(dappKey, {
        dapp: dappKey,
        dapp_url: p.dapp?.url ?? null,
        module: p.protocol_module ?? null,
        net_value: 0,
        gross_value: 0,
        groups: new Map(),
      });
    }
    const entry = byDapp.get(dappKey);
    entry.net_value += signedValue(p);
    entry.gross_value += p.value || 0;

    // Pool/group rollup: tokens sharing a group_id render as one pool. Tokens
    // without a group_id each get their own synthetic key so they render flat.
    const groupKey = p.group_id ? `g:${p.group_id}` : `t:${entry.groups.size}:${p.symbol}`;
    if (!entry.groups.has(groupKey)) {
      entry.groups.set(groupKey, {
        group_id: p.group_id ?? null,
        position_type: p.position_type ?? null,
        pool_address: p.pool_address ?? null,
        value: 0,
        tokens: [],
      });
    }
    const g = entry.groups.get(groupKey);
    g.value += p.value || 0;
    g.tokens.push({
      symbol: p.symbol,
      name: p.name,
      chain: p.chain,
      quantity: p.quantity,
      value: p.value,
      price: p.price,
      change_percent_1d: p.change_percent_1d,
      position_type: p.position_type,
    });
  }
  // Flatten Maps to arrays sorted by value desc.
  return [...byDapp.values()]
    .map((d) => ({
      dapp: d.dapp,
      dapp_url: d.dapp_url,
      module: d.module,
      net_value: d.net_value,
      gross_value: d.gross_value,
      groups: [...d.groups.values()].sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.gross_value - a.gross_value);
}
