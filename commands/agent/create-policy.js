import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { print, printError } from "../../utils/util/output.js";
import { createPolicy, toCaip2, allChainNames } from "../../utils/wallet/keystore.js";
import { shortenScriptPaths } from "../../utils/util/format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = join(__dirname, "..", "..", "policies");

function parseExpires(input) {
  // Relative: 1h, 24h, 7d, 30d
  const match = input.match(/^(\d+)([hd])$/i);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms =
      unit === "h" ? n * 3600_000 :
      unit === "d" ? n * 86400_000 : 0;
    return new Date(Date.now() + ms).toISOString();
  }
  // Absolute: ISO date or YYYY-MM-DD
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default async function agentCreatePolicy(args, flags) {
  const name = flags.name || args[0];
  if (!name) {
    printError("missing_args", "Policy name required", {
      example:
        'zerion agent create-policy --name "base-only" --chains base,arbitrum --expires 24h',
    });
    process.exit(1);
  }

  const rules = [];
  let executable = null;
  let config = null;

  // 1. Chain restriction (built-in)
  if (flags.chains) {
    const chainNames = flags.chains.split(",").map((c) => c.trim());
    const valid = allChainNames();
    const invalid = chainNames.filter((c) => !valid.includes(c));
    if (invalid.length > 0) {
      printError("invalid_chain", `Unknown chain(s): ${invalid.join(", ")}`, {
        suggestion: `Valid chains: ${valid.join(", ")}`,
      });
      process.exit(1);
    }
    rules.push({
      type: "allowed_chains",
      chain_ids: chainNames.map(toCaip2),
    });
  }

  // 2. Expiry (built-in)
  if (flags.expires) {
    const timestamp = parseExpires(flags.expires);
    if (!timestamp) {
      printError("invalid_expires", `Cannot parse expiry: "${flags.expires}"`, {
        suggestion: "Use relative (24h, 7d, 30d) or absolute (2026-06-01) format",
      });
      process.exit(1);
    }
    rules.push({ type: "expires_at", timestamp });
  }

  // 3. Executable policies — combine into a single wrapper script
  const execPolicies = [];
  if (flags["deny-transfers"]) execPolicies.push("deny-transfers");
  if (flags["deny-approvals"]) execPolicies.push("deny-approvals");
  if (flags.allowlist) execPolicies.push("allowlist");

  if (execPolicies.length > 0) {
    // OWS supports one executable per policy — use a dispatcher
    executable = join(POLICIES_DIR, "run-policies.mjs");
    config = {
      scripts: execPolicies.map((s) => join(POLICIES_DIR, `${s}.mjs`)),
    };
    if (flags.allowlist) {
      config.allowed_addresses = flags.allowlist.split(",").map((a) => a.trim());
    }
  }

  if (rules.length === 0 && !executable) {
    printError("empty_policy", "Policy must have at least one rule", {
      suggestion: "Add --chains, --expires, --deny-transfers, --deny-approvals, or --allowlist",
    });
    process.exit(1);
  }

  const id = `policy-${name}-${randomUUID().slice(0, 8)}`;

  try {
    const policy = createPolicy(id, name, rules, executable, config);

    print({
      policy: {
        id: policy.id,
        name: policy.name,
        rules: policy.rules,
        executable: !!executable,
        config: config
          ? { ...config, scripts: shortenScriptPaths(config.scripts) }
          : null,
      },
      created: true,
      usage: `Attach to a token: zerion agent create-token --name <bot> --wallet <wallet> --policy ${policy.id}`,
    });
  } catch (err) {
    printError("ows_error", `Failed to create policy: ${err.message}`);
    process.exit(1);
  }
}
