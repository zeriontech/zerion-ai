export function isStale(nonce, onchainNonce) {
  return BigInt(nonce) < onchainNonce;
}

function conflictAt(queued, nonce) {
  const hit = queued.find((tx) => BigInt(tx.nonce) === nonce);
  return hit ? { safeTxHash: hit.safeTxHash } : null;
}

export function selectNonce({ onchainNonce, queued = [], requested }) {
  if (requested === undefined) {
    let nonce = onchainNonce;
    for (const tx of queued) {
      const queuedNonce = BigInt(tx.nonce);
      if (queuedNonce >= onchainNonce && queuedNonce + 1n > nonce) nonce = queuedNonce + 1n;
    }
    return { nonce, conflict: null };
  }

  const nonce = requested === "next" ? onchainNonce : BigInt(requested);
  if (isStale(nonce, onchainNonce)) {
    const err = new Error(`Nonce ${nonce} is already used: the Safe's on-chain nonce is ${onchainNonce}`);
    err.code = "safe_nonce_stale";
    err.nonce = nonce.toString();
    err.onchainNonce = onchainNonce.toString();
    throw err;
  }
  return { nonce, conflict: conflictAt(queued, nonce) };
}
