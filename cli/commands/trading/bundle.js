/**
 * `zerion bundle` — collect several prepared groups (repeatable `--group`),
 * re-validate them, pick ONE route for the whole queue (strictest-wins), and
 * execute both routes.
 *
 *   zerion bundle --group "$(zerion swap base 100 USDC ETH --prepare)" \
 *                 --group "$(zerion send USDC 20 --to 0xBob --chain base --prepare)"
 *
 * Pipeline (docs/prd/cli-bundle.md §4): parse & validate shape → same-signer
 * invariant → re-validate (policies + aggregate balance + quote freshness) →
 * route (any web-app ⇒ whole queue web-app; else local) → execute → report
 * per-group. **Always exits 0** for execution outcomes (callers read per-group
 * `status`); pre-flight rejections (bad `--group`, mixed signer, aggregate
 * over-balance) exit non-zero because nothing was executed.
 *
 * Architecture: this is the CLI shell (network: policies, balances, handoff,
 * local signing). Pure logic lives in `cli/utils/trading/bundle.js`.
 */

import * as api from "../../utils/api/client.js";
import { parseTimeout, requireAgentToken, enforceExecutablePolicies } from "../../utils/trading/guards.js";
import { print, printError } from "../../utils/common/output.js";
import { signBundleViaWebApp } from "../../utils/web-app/handoff.js";
import { parsePreparedGroup } from "../../utils/web-app/prepared-group.js";
import {
  signSwapTransaction,
  broadcastAndWait,
  getPublicClient,
} from "../../utils/trading/transaction.js";
import { signAndBroadcastSolana } from "../../utils/chain/solana.js";
import {
  normalizeGroupInputs,
  assertSameSigner,
  decideBundleRoute,
  aggregateOutflows,
  matchPositionBalance,
  quoteFreshnessWarnings,
  computeBundleStatus,
} from "../../utils/trading/bundle.js";

// A short human label for a group's report row — the first tx label, else the
// command key from its summary.
function groupLabel(group) {
  const firstLabelled = (group.transactions || []).find((t) => t.label);
  if (firstLabelled) return firstLabelled.label;
  const key = Object.keys(group.summary || {})[0];
  return key || "group";
}

export default async function bundle(args, flags) {
  // 1. Parse & validate shape — reject anything that isn't a prepared group.
  let groups;
  try {
    const inputs = normalizeGroupInputs(flags.group);
    groups = inputs.map((raw, i) => parsePreparedGroup(raw, i));
  } catch (err) {
    printError(err.code || "invalid_group", err.message);
    process.exit(1);
  }

  // 2. Cross-group invariant — same signer address (⇒ same ecosystem). Chains
  // may differ (cross-chain bundle).
  let signer;
  try {
    signer = assertSameSigner(groups);
  } catch (err) {
    printError(err.code || "mixed_address", err.message);
    process.exit(1);
  }
  const { address, ecosystem } = signer;

  // 3a. Re-validate policies — the `--group` blobs are untrusted stdin, so run
  // enforceExecutablePolicies again per EVM tx before a link forms or a tx signs.
  for (const g of groups) {
    for (const entry of g.transactions) {
      if (!entry.evm) continue;
      await enforceExecutablePolicies({
        to: entry.evm.to,
        value: entry.evm.value || "0",
        data: entry.evm.data,
        chain: g.chain,
      });
    }
  }

  // 3b. Quote freshness — warn (can't silently re-quote) when a group is stale.
  for (const w of quoteFreshnessWarnings(groups, { nowMs: Date.now() })) {
    process.stderr.write(`Warning: ${w}\n`);
  }

  // 3c. Aggregate per-token outflow vs live balance — catches sums that each
  // passed alone but overspend together. A definite over-balance is a pre-flight
  // rejection (exit non-zero, nothing executed); an undeterminable balance
  // degrades to a warning rather than a false refusal.
  await checkAggregateBalance(groups, address);

  // 4. Route the whole queue — strictest-wins.
  const route = decideBundleRoute(groups);
  process.stderr.write(
    `Bundle route: ${route} — ${route === "web-app"
      ? "at least one group requires human review"
      : "all groups auto-sign locally"}.\n`
  );

  const timeout = parseTimeout(flags.timeout);

  if (route === "web-app") {
    await runWebAppRoute(groups, address, timeout);
    return;
  }
  await runLocalRoute(groups, ecosystem, timeout);
}

/**
 * Aggregate-outflow gate. Sums sell-side outflows per (chain, token) and
 * compares to live wallet balances from the positions API. Refuses (exit 1) on
 * a definite over-balance; warns and continues when a balance can't be read.
 */
async function checkAggregateBalance(groups, address) {
  const outflows = aggregateOutflows(groups);
  if (outflows.length === 0) return;

  // One positions fetch per distinct chain.
  const chains = [...new Set(outflows.map((o) => o.chain))];
  const positionsByChain = new Map();
  for (const chain of chains) {
    try {
      const res = await api.getPositions(address, { chainId: chain, positionFilter: "only_simple" });
      positionsByChain.set(chain, res.data || []);
    } catch (err) {
      process.stderr.write(
        `Warning: could not fetch balances on ${chain} (${err.message}) — ` +
        `skipping the aggregate-balance check there.\n`
      );
    }
  }

  for (const o of outflows) {
    const positions = positionsByChain.get(o.chain);
    if (!positions) continue; // fetch failed — already warned
    const balance = matchPositionBalance(positions, o);
    if (balance == null) {
      process.stderr.write(
        `Warning: could not find a ${o.symbol} balance on ${o.chain} to verify the ` +
        `aggregate outflow (${o.amount}). Proceeding — the web app / RPC will still gate.\n`
      );
      continue;
    }
    if (o.amount > balance + 1e-9) {
      printError(
        "insufficient_aggregate_balance",
        `Bundle would spend ${o.amount} ${o.symbol} on ${o.chain} but the wallet holds ${balance}.`,
        {
          suggestion:
            "The groups each pass alone but overspend together — drop one or lower an amount.",
        },
      );
      process.exit(1);
    }
  }
}

// Merge a per-group execution result with its prepared-group label + summary.
function reportRow(group, result) {
  const row = {
    label: groupLabel(group),
    summary: group.summary || {},
    status: result.status,
  };
  if (result.hashes && result.hashes.length) row.hashes = result.hashes;
  if (result.error) row.error = result.error;
  return row;
}

async function runWebAppRoute(groups, address, timeout) {
  const result = await signBundleViaWebApp({
    address,
    groups: groups.map((g) => g.transactions),
    timeout,
  });

  // signBundleViaWebApp returns per-group results on a terminal `completed`;
  // for whole-session terminals (timeout/aborted/rejected/failed) it may not,
  // so synthesise one row per group carrying the session status.
  const perGroup = result.groups && result.groups.length === groups.length
    ? result.groups
    : groups.map(() => ({ status: result.status }));

  const rows = groups.map((g, i) => reportRow(g, perGroup[i]));

  print({ route: "web-app", status: result.status, groups: rows });
  if (result.status === "aborted") {
    process.stderr.write("Aborted while waiting — some groups may still complete in the browser.\n");
  }
  // Always exit 0 — partial success is a normal batch outcome.
}

async function runLocalRoute(groups, ecosystem, timeout) {
  // Require the agent token ONCE for the whole batch (all groups share a signer).
  const walletName = groups[0].walletName;
  const passphrase = await requireAgentToken("for bundle signing", walletName);

  const rows = [];
  const statuses = [];
  for (const g of groups) {
    let result;
    try {
      result = await signGroupLocally(g, { walletName, passphrase, timeout });
    } catch (err) {
      result = { status: "failed", error: err?.message || String(err) };
    }
    statuses.push(result.status);
    rows.push(reportRow(g, result));
  }

  print({ route: "local", status: computeBundleStatus(statuses), groups: rows });
  // Always exit 0.
}

// Sign + broadcast one group locally, sequentially. Re-fetches the pending
// nonce for the group's chain and increments across the group's txs.
async function signGroupLocally(group, { walletName, passphrase, timeout }) {
  const hashes = [];

  if (group.ecosystem === "solana") {
    for (const entry of group.transactions) {
      if (!entry.solana?.raw) continue;
      const res = await signAndBroadcastSolana({ raw: entry.solana.raw }, walletName, passphrase);
      const sig = res.hash || res.signature;
      if (sig) hashes.push(sig);
      if (res.status && res.status !== "success" && res.status !== "confirmed") {
        return { status: "failed", hashes, error: `Solana tx ${sig} did not confirm` };
      }
    }
    return { status: "completed", hashes };
  }

  const client = await getPublicClient(group.chain);
  let nonce = Number(await client.getTransactionCount({ address: group.address, blockTag: "pending" }));
  for (const entry of group.transactions) {
    if (!entry.evm) continue;
    const { signedTxHex, client: txClient } = await signSwapTransaction(
      entry.evm,
      group.chain,
      walletName,
      passphrase,
      { nonceOverride: nonce },
    );
    const res = await broadcastAndWait(txClient, signedTxHex, { timeout });
    hashes.push(res.hash);
    if (res.status !== "success") {
      return { status: "failed", hashes, error: `Transaction ${res.hash} reverted` };
    }
    nonce += 1;
  }
  return { status: "completed", hashes };
}
