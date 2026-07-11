/* Background Sync — flushes the offline action queue (Like/Save/Follow)
 * even when the app isn't open, the gap a foreground-only `online` listener
 * (features/app-shell/offline-queue-sync.tsx) can't cover. Chrome/Edge/
 * Samsung Internet only (SyncManager); Safari/Firefox lack it and keep
 * relying on that foreground listener as their baseline — this is additive,
 * not a replacement.
 *
 * Reads/writes the SAME IndexedDB database as lib/offline/action-queue.ts
 * (name, store, and schema below must stay in sync with that file — a
 * service worker can't import a TS module, so this is a deliberate,
 * minimal, vanilla-JS mirror of its enqueue schema, not a duplicate queue). */
const SWX = (self.SWX = self.SWX || {});

const DB_NAME = "frenz-offline-queue";
const STORE = "actions";
const DB_VERSION = 1;
SWX.SYNC_TAG = "frenz-replay-offline-queue";

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function listActions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function removeAction(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Mirrors shouldDropAfterStatus() in lib/offline/action-queue.ts exactly: a
// 2xx (succeeded) or 4xx (a client error that will never succeed on retry)
// drops the action; a 5xx/network failure leaves it queued.
function shouldDropAfterStatus(status) {
  return (status >= 200 && status < 300) || (status >= 400 && status < 500);
}

async function replayQueueFromSw() {
  const db = await openQueueDb();
  try {
    const actions = (await listActions(db)).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const action of actions) {
      try {
        const res = await fetch(action.url, {
          method: action.method,
          headers: action.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: action.body !== undefined ? JSON.stringify(action.body) : undefined,
        });
        if (shouldDropAfterStatus(res.status)) await removeAction(db, action.key);
      } catch {
        break; // still offline — leave the rest queued, the next sync retries
      }
    }
    SWX.log("background sync replay done");
  } finally {
    db.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === SWX.SYNC_TAG) event.waitUntil(replayQueueFromSw());
});
