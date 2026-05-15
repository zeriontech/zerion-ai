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
import { validateChain, validatePositions, resolvePositionFilter } from "../../utils/common/validate.js";
import { resolveAuth } from "../../utils/api/auth.js";
import { formatPositions, formatDefiPositions } from "../../utils/common/format.js";

export default async function walletPositions(args, flags) {
  const chainErr = validateChain(flags.chain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  // --defi is shorthand for --positions defi + DeFi-grouped output.
  // Conflict only if user also passed an incompatible --positions value.
  const defiMode = !!flags.defi;
  if (defiMode && flags.positions && flags.positions !== "defi") {
    printError(
      "conflicting_flags",
      `--defi cannot be combined with --positions ${flags.positions}. Use one or the other.`,
    );
    process.exit(1);
  }
  if (defiMode) flags.positions = "defi";

  const posErr = validatePositions(flags.positions);
  if (posErr) {
    printError(posErr.code, posErr.message, { supportedValues: posErr.supportedValues });
    process.exit(1);
  }

  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const auth = resolveAuth(flags);
    const response = await api.getPositions(address, {
      chainId: flags.chain,
      positionFilter: resolvePositionFilter(flags.positions),
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
        chain: flags.chain ?? null,
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

    print({
      wallet: { name: walletName, address },
      positions,
      count: positions.length,
      filter: flags.positions || "all",
    }, formatPositions);
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
