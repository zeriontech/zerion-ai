/**
 * The prepared-group envelope — the output of a trading command run with
 * `--prepare` and the input the `bundle` command collects (repeatable
 * `--group`).
 *
 * A prepared group is a self-describing, **nonce-free** envelope wrapping
 * exactly one group (one command's transaction list): a `send` is one tx, a
 * `swap` is `[approve?, swap]`, a `consolidate` is all its approve+swap pairs.
 * It carries the command's **gate decision** (`route`) so `bundle` can pick a
 * route for the whole queue (strictest-wins) without re-deriving it, the human
 * `summary` for the final report, and enough structured context
 * (`outflows`, `preparedAt`) for `bundle` to re-validate untrusted `--group`
 * stdin (aggregate balance + quote freshness).
 *
 * `--prepare` builds + gates but does **not** execute or open the browser — it
 * only prints this envelope (compact JSON) to stdout. See docs/prd/cli-bundle.md.
 */

export const PREPARED_GROUP_KIND = "zerion-prepared-group";
export const PREPARED_GROUP_VERSION = 1;

/**
 * Print a prepared-group envelope as **compact** single-line JSON to stdout so
 * it's cleanly shell-quotable for `bundle --group "$(… --prepare)"`. Progress /
 * routing notes go to stderr (as elsewhere), keeping stdout a single blob.
 */
export function printPreparedGroup(envelope) {
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

/**
 * Assemble a prepared-group envelope. Callers pass already-built, **nonce-free**
 * transactions (from `toTransactionEVM` without a nonce, or `toSolanaTransaction`).
 *
 * @param {object} args
 * @param {"evm"|"solana"} args.ecosystem
 * @param {string} args.chain - single Zerion chain id for the group
 * @param {string} args.address - signer (0x for EVM, base58 for Solana)
 * @param {string} args.walletName - resolved wallet name (local-signing path needs it)
 * @param {"local"|"web-app"} args.route - the per-group decideSigningRoute decision
 * @param {object} args.summary - the command's human summary (for bundle's report)
 * @param {Array<{evm?:object,solana?:object,label?:string}>} args.transactions
 * @param {Array<{fungibleId?:string,chain:string,symbol:string,amount:string|number,tokenAddress?:string,native?:boolean}>} [args.outflows]
 *   - sell-side amounts leaving the wallet (for bundle's aggregate-balance check)
 * @param {string} [args.preparedAt] - ISO timestamp (defaults to now); bundle
 *   uses it for a best-effort quote-freshness warning
 * @returns {object} the envelope
 */
export function buildPreparedGroup({
  ecosystem,
  chain,
  address,
  walletName,
  route,
  summary,
  transactions,
  outflows = [],
  preparedAt,
}) {
  if (ecosystem !== "evm" && ecosystem !== "solana") {
    throw new Error(`prepared group: invalid ecosystem "${ecosystem}"`);
  }
  if (!chain) throw new Error("prepared group: missing chain");
  if (!address) throw new Error("prepared group: missing address");
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("prepared group: transactions must be a non-empty array");
  }
  return {
    kind: PREPARED_GROUP_KIND,
    version: PREPARED_GROUP_VERSION,
    ecosystem,
    chain,
    address,
    walletName,
    route,
    summary: summary || {},
    outflows,
    preparedAt: preparedAt || new Date().toISOString(),
    transactions,
  };
}

/**
 * Parse + validate a `--group` value into a prepared-group envelope. Rejects
 * anything that isn't a well-formed `kind: "zerion-prepared-group"` envelope —
 * the `--group` blobs are untrusted stdin, so `bundle` must not trust their
 * shape. Throws an Error with a `code` so the caller can `printError` cleanly.
 *
 * @param {string} raw - the JSON string passed to one `--group`
 * @param {number} [index] - position in the queue (for clearer error messages)
 * @returns {object} the validated envelope
 */
export function parsePreparedGroup(raw, index) {
  const where = index != null ? ` (group #${index + 1})` : "";
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const err = new Error(
      `--group${where} is not valid JSON. Pass the output of a \`--prepare\` command, ` +
      `e.g. --group "$(zerion send USDC 10 --to 0x… --chain base --prepare)".`
    );
    err.code = "invalid_group";
    throw err;
  }
  if (!obj || typeof obj !== "object" || obj.kind !== PREPARED_GROUP_KIND) {
    const err = new Error(
      `--group${where} is not a prepared-group envelope (missing kind: "${PREPARED_GROUP_KIND}"). ` +
      `Produce one with a \`--prepare\` command.`
    );
    err.code = "invalid_group";
    throw err;
  }
  if (obj.ecosystem !== "evm" && obj.ecosystem !== "solana") {
    const err = new Error(`--group${where} has an invalid ecosystem "${obj.ecosystem}".`);
    err.code = "invalid_group";
    throw err;
  }
  if (!obj.address) {
    const err = new Error(`--group${where} is missing a signer address.`);
    err.code = "invalid_group";
    throw err;
  }
  if (!obj.chain) {
    const err = new Error(`--group${where} is missing a chain.`);
    err.code = "invalid_group";
    throw err;
  }
  if (!Array.isArray(obj.transactions) || obj.transactions.length === 0) {
    const err = new Error(`--group${where} carries no transactions.`);
    err.code = "invalid_group";
    throw err;
  }
  for (const tx of obj.transactions) {
    if (!tx || typeof tx !== "object" || (!tx.evm && !tx.solana)) {
      const err = new Error(`--group${where} has a transaction entry without an evm/solana payload.`);
      err.code = "invalid_group";
      throw err;
    }
  }
  return obj;
}
