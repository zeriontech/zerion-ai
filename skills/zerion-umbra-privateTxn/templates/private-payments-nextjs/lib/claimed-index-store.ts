// Per-wallet IndexedDB-backed set of UTXO ids that have been claimed.
// Mirrors frontend-core's claimed-index-store: prevents redundant claim
// attempts when the indexer hasn't yet caught up with the on-chain
// nullifier burn (typical 1–2 block lag).

const DB_NAME = "umbra-claimed-utxos";
const STORE = "claimed";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadClaimed(wallet: string): Promise<Set<string>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(wallet);
    req.onsuccess = () => resolve(new Set((req.result as string[] | undefined) ?? []));
    req.onerror = () => reject(req.error);
  });
}

export async function addClaimed(wallet: string, utxoIds: readonly string[]): Promise<void> {
  if (utxoIds.length === 0) return;
  const existing = await loadClaimed(wallet);
  for (const id of utxoIds) existing.add(id);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put([...existing], wallet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function filterUnclaimed<T extends { id: string }>(
  utxos: readonly T[],
  claimed: ReadonlySet<string>,
): T[] {
  return utxos.filter((u) => !claimed.has(u.id));
}
