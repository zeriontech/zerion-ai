// Persisted scan cursor in IndexedDB. The indexer is UNTRUSTED but
// cheap — we resume incremental scans by passing the saved
// (treeIndex, insertionIndex) to the scanner on each session.
// See SKILL.md Rule 8 + flows.md §6.

interface Cursor {
  treeIndex: number;
  insertionIndex: number;
  updatedAt: number;
}

const DB_NAME = "umbra-scan-cursor";
const STORE = "cursors";
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

export async function loadCursor(address: string): Promise<Cursor | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(address);
    req.onsuccess = () => resolve((req.result as Cursor | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCursor(address: string, cursor: Omit<Cursor, "updatedAt">): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...cursor, updatedAt: Date.now() } satisfies Cursor, address);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function resetCursor(address: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(address);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
