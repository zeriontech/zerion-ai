export function decodePolicyType(policyType) {
  if ("subscription" in policyType) {
    const sub = policyType.subscription;
    return {
      type: "subscription",
      amount: sub.amount.toString(),
      autoRenew: sub.autoRenew,
      maxRenewals: sub.maxRenewals,
      frequency: decodeFrequency(sub.paymentFrequency),
      nextPaymentDue: sub.nextPaymentDue.toNumber(),
    };
  }
  if ("milestone" in policyType) {
    const ms = policyType.milestone;
    return {
      type: "milestone",
      amounts: ms.milestoneAmounts.map((a) => a.toString()),
      timestamps: ms.milestoneTimestamps.map((t) => t.toNumber()),
      currentMilestone: ms.currentMilestone,
      totalMilestones: ms.totalMilestones,
      escrowAmount: ms.escrowAmount.toString(),
    };
  }
  if ("payAsYouGo" in policyType) {
    const payg = policyType.payAsYouGo;
    return {
      type: "payAsYouGo",
      maxPerPeriod: payg.maxAmountPerPeriod.toString(),
      maxChunk: payg.maxChunkAmount.toString(),
      periodSeconds: payg.periodLengthSeconds.toNumber(),
      periodStart: payg.currentPeriodStart.toNumber(),
      periodTotal: payg.currentPeriodTotal.toString(),
    };
  }
  return { type: "unknown" };
}

export function formatAmount(smallestUnits, decimals = 6) {
  const raw = Number(smallestUnits) / Math.pow(10, decimals);
  return raw.toFixed(decimals > 2 ? 2 : decimals);
}

export function decodeFrequency(freq) {
  if ("daily" in freq) return "daily";
  if ("weekly" in freq) return "weekly";
  if ("monthly" in freq) return "monthly";
  if ("quarterly" in freq) return "quarterly";
  if ("semiAnnually" in freq) return "semi-annually";
  if ("annually" in freq) return "annually";
  if ("custom" in freq) return `custom (${freq.custom.seconds}s)`;
  return "unknown";
}

export function decodeStatus(status) {
  if ("active" in status) return "active";
  if ("paused" in status) return "paused";
  return "unknown";
}

export function decodeMemo(memoBytes) {
  if (!memoBytes || !memoBytes.length) return "";
  const buf = Buffer.from(memoBytes);
  const firstZero = buf.indexOf(0);
  if (firstZero === 0) return "";
  return buf.slice(0, firstZero >= 0 ? firstZero : undefined).toString("utf-8");
}

export function encodeMemo(memo, maxLength = 64) {
  const encoded = Buffer.from(memo || "", "utf-8");
  const padded = Buffer.alloc(maxLength);
  encoded.copy(padded);
  return Array.from(padded);
}

export function formatPolicyRow(policy, decimals = 6) {
  const decoded = decodePolicyType(policy.account.policyType);
  const status = decodeStatus(policy.account.status);
  const typeLabel =
    decoded.type === "subscription"
      ? "sub"
      : decoded.type === "payAsYouGo"
        ? "payg"
        : decoded.type === "milestone"
          ? "mile"
          : "?";

  let amount, interval;
  if (decoded.type === "subscription") {
    amount = `${formatAmount(decoded.amount, decimals)} USDC`;
    interval = decoded.frequency;
  } else if (decoded.type === "payAsYouGo") {
    amount = `${formatAmount(decoded.maxPerPeriod, decimals)}/cap`;
    interval = formatPeriod(decoded.periodSeconds);
  } else {
    amount = `${formatAmount(decoded.escrowAmount, decimals)} escrow`;
    interval = "-";
  }

  const nextDue =
    decoded.type === "subscription" && decoded.nextPaymentDue
      ? new Date(decoded.nextPaymentDue * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "-";

  return {
    id: policy.account.policyId,
    type: typeLabel,
    amount,
    interval,
    nextDue,
    status,
  };
}

export function formatPeriod(seconds) {
  if (seconds === 86400) return "24h";
  if (seconds === 604800) return "7d";
  if (seconds === 2592000) return "30d";
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return `${seconds}s`;
}

export function formatPrettyTable(address, policies) {
  const shortAddr = address.slice(0, 6) + "..." + address.slice(-4);
  const rows = policies.map((p) => {
    const row = formatPolicyRow(p);
    return `│ ${String(row.id).padEnd(4)} │ ${row.type.padEnd(8)} │ ${row.amount.padEnd(8)} │ ${row.interval.padEnd(9)} │ ${row.nextDue.padEnd(11)} │ ${row.status.padEnd(11)} │`;
  });

  const header =
    "│ ID   │ Type     │ Amount   │ Interval  │ Next Due    │ Status      │";
  const sep =
    "├──────┼──────────┼──────────┼───────────┼─────────────┼─────────────┤";

  let table = `╭─────────────────────────────────────────────────────────────────────╮\n`;
  table += `│  Tributary Subscriptions — wallet: ${shortAddr.padEnd(32)}│\n`;
  table += `├──────┬──────────┬──────────┬───────────┬─────────────┬─────────────┤\n`;
  table += `${header}\n`;
  table += `${sep}\n`;
  for (const row of rows) {
    table += `${row}\n`;
  }
  table += `╰──────┴──────────┴──────────┴───────────┴─────────────┴─────────────╯\n`;
  return table;
}
