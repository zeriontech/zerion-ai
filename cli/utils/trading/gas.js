/**
 * Gas-limit estimation for locally-built transactions (`send`).
 *
 * Never hardcode a gas limit — chains vary. 21,000 is the *intrinsic* cost of a
 * plain EVM transfer, but several chains Zerion supports charge more than that
 * before the transaction even executes:
 *
 *   - Arbitrum Nitro / Orbit chains fold the L1 poster (calldata) cost into the
 *     transaction's gas requirement, and it drifts with the L1 base fee.
 *     Measured floors: robinhood ~21.9k, arbitrum ~21.6k, ape ~21.2k.
 *   - zkSync-stack chains need ~143k for the same transfer (lens,
 *     cronos-zkevm, zkcandy; zklink-nova ~142k).
 *   - Others sit in between: megaeth 60k, aurora 28k, hyperevm ~22.8k.
 *
 * Submitting less is rejected pre-inclusion with `intrinsic gas too low` /
 * `gas required exceeds allowance`, so the transaction never lands and no gas
 * is burned — but it never lands. Estimation is the fix; a constant is only
 * ever the fallback for when estimation itself is unavailable.
 */

// Signals that the node rejected the estimate for lack of funds rather than
// because the call would revert. Native sends hit this when the amount is
// close to the whole balance: the node checks `value + gas × price` against
// the balance before it will estimate anything.
const INSUFFICIENT_FUNDS_RE = /insufficient funds|exceeds balance|gas \* price/i;

// Signals the call itself would revert — worth aborting on rather than
// broadcasting a transaction we know will fail and lose its gas.
const WOULD_REVERT_RE = /exceeds balance|insufficient|underflow/i;

const withBuffer = (gas) => (gas * 120n) / 100n; // 20% headroom

/**
 * Estimate a transaction's gas limit, falling back to a constant only when the
 * node can't give us an answer.
 *
 * @param {object} args
 * @param {object} args.client - viem public client
 * @param {string} args.account - sender address
 * @param {string} args.to - recipient (EOA or contract)
 * @param {string} [args.data] - calldata, "0x" for a native transfer
 * @param {bigint} [args.value] - native value attached to the call
 * @param {bigint} args.fallback - gas limit to use when estimation fails
 * @returns {Promise<bigint>} estimated gas plus a 20% buffer, or `fallback`
 * @throws when the node reports the call would definitely revert
 */
export async function estimateGasWithFallback({
  client,
  account,
  to,
  data = "0x",
  value = 0n,
  fallback,
}) {
  try {
    return withBuffer(await client.estimateGas({ account, to, data, value }));
  } catch (err) {
    const msg = err?.message || "";

    // Send-max case: the node won't estimate because `value` already consumes
    // the balance. Re-estimate at zero value — what we're after is the
    // intrinsic + L1-data cost, which doesn't depend on the amount. The caller's
    // balance gate still gets the last word, and now with a real gas number.
    if (value > 0n && INSUFFICIENT_FUNDS_RE.test(msg)) {
      try {
        return withBuffer(await client.estimateGas({ account, to, data, value: 0n }));
      } catch {
        // fall through — treat it like any other estimation failure below
      }
    }

    // A definite revert is worth surfacing: broadcasting it only burns gas.
    // Native sends are exempt — for those an "insufficient" message means the
    // wallet is short, which the caller's balance gate reports far better than
    // a revert error would.
    if (value === 0n && WOULD_REVERT_RE.test(msg)) {
      const error = new Error(
        `Transfer would fail: ${msg.split("\n")[0]}. Check your token balance.`
      );
      error.code = "transfer_would_revert";
      error.suggestion = "Check your balance with: zerion positions";
      throw error;
    }

    process.stderr.write(
      `WARNING: Gas estimation failed (${msg.split("\n")[0]}). ` +
        `Using fallback of ${fallback}. On chains that charge more than the ` +
        `intrinsic minimum this may be rejected as "intrinsic gas too low".\n`
    );
    return fallback;
  }
}

// Gas floors used only when estimation is unavailable.
export const NATIVE_TRANSFER_GAS = 21000n;
export const ERC20_TRANSFER_GAS = 65000n;
