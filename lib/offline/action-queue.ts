/**
 * Generic offline write queue — the "Offline Interactions" ask: safe only for
 * idempotent, toggle-style actions (Like/Save today) where replaying the
 * LATEST desired state is correct even if the user flipped it multiple times
 * while offline. Not a general job queue — comments/reposts (need a
 * client-generated id to dedupe against double-posting) and anything
 * non-idempotent are deliberately NOT routed through this, a bigger lift for
 * a later slice (see docs/PROJECT_NOTES.md batch 36).
 *
 * IndexedDB-backed (survives a real app restart, unlike an in-memory queue),
 * keyed by a caller-chosen `key` (e.g. `like:<postId>`) so a later queued
 * action with the same key REPLACES the earlier one via a keyed `put`
 * instead of both replaying in sequence.
 */

const DB_NAME = "frenz-offline-queue";
const STORE = "actions";
const DB_VERSION = 1;
// Must match SWX.SYNC_TAG in public/sw/background-sync.js exactly — the two
// sides can't share a literal (a service worker can't import a TS module).
const SYNC_TAG = "frenz-replay-offline-queue";

export interface QueuedAction {
  key: string;
  url: string;
  method: "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
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

interface SyncRegistration extends ServiceWorkerRegistration {
  sync: { register(tag: string): Promise<void> };
}

/** Best-effort: asks the service worker to flush the queue via Background
 * Sync (public/sw/background-sync.js) the moment connectivity returns, even
 * if this tab/app isn't open then. Chrome/Edge/Samsung Internet only —
 * Safari/Firefox lack SyncManager and keep relying on the foreground
 * `online` listener (offline-queue-sync.tsx) as their baseline; this is
 * additive, so its absence here is never a functional regression. */
async function requestBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) await (reg as SyncRegistration).sync.register(SYNC_TAG);
  } catch {
    /* SyncManager unsupported, or registration failed — fine, see above */
  }
}

/** Queue (or replace, by `key`) an offline write. Fails silently if
 * IndexedDB is unavailable (private browsing etc.) — same fail-open trade-off
 * every other best-effort cache in this app already accepts. */
export async function enqueueOfflineAction(action: Omit<QueuedAction, "queuedAt">): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...action, queuedAt: Date.now() } satisfies QueuedAction);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    void requestBackgroundSync();
  } catch {
    /* IndexedDB unavailable — the action is simply lost */
  }
}

async function listActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  const items = await new Promise<QueuedAction[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return items;
}

async function removeAction(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Whether an offline write is currently queued under `key` — lets a caller
 * skip a redundant enqueue/UI state churn if nothing actually changed. */
export async function hasQueuedAction(key: string): Promise<boolean> {
  try {
    const actions = await listActions();
    return actions.some((a) => a.key === key);
  } catch {
    return false;
  }
}

/**
 * Whether a replayed action's HTTP status means "done, remove from the
 * queue" — a 2xx (succeeded) or a 4xx (a client error that will never
 * succeed on retry, e.g. an expired session or a since-deleted post). A 5xx
 * leaves it queued for the next reconnect. Exported pure so it has its own
 * logic test independent of IndexedDB/fetch.
 */
export function shouldDropAfterStatus(status: number): boolean {
  return (status >= 200 && status < 300) || (status >= 400 && status < 500);
}

const METHODS = new Set(["POST", "DELETE", "PUT", "PATCH"]);

/**
 * Guards against a corrupted/old-schema IndexedDB record (a future schema
 * change, manual tampering, or storage corruption) reaching `fetch()` —
 * without this, a single malformed record throws inside the replay loop's
 * try/catch, which reads as "still offline" and `break`s, silently
 * stranding every VALID action queued after it too. Exported pure so it has
 * its own logic test independent of IndexedDB.
 */
export function isValidQueuedAction(x: unknown): x is QueuedAction {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.key === "string" &&
    a.key.length > 0 &&
    typeof a.url === "string" &&
    a.url.length > 0 &&
    typeof a.method === "string" &&
    METHODS.has(a.method) &&
    typeof a.queuedAt === "number"
  );
}

let replaying = false;

/**
 * Replays every queued action, oldest first. A network exception (still
 * offline, or went offline again mid-pass) stops the whole pass immediately,
 * keeping every remaining action queued in its original order for next time.
 * Invalid records are dropped immediately (not left to jam the pass) rather
 * than retried — there's no version of "retry" that fixes a malformed record.
 */
export async function replayOfflineActions(): Promise<void> {
  if (replaying || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  replaying = true;
  try {
    const all = await listActions();
    const invalid = all.filter((a) => !isValidQueuedAction(a));
    if (invalid.length) {
      await Promise.all(invalid.map((a) => removeAction((a as { key?: string }).key ?? "").catch(() => {})));
    }
    const actions = all.filter(isValidQueuedAction).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const action of actions) {
      // Body serialization is deliberately OUTSIDE the network try/catch
      // below: isValidQueuedAction doesn't (can't cheaply) verify `body` is
      // JSON-serializable, so a malformed body must be treated as "drop this
      // one record" — not caught by the same handler that means "still
      // offline, stop the whole pass," which would wrongly strand every
      // valid action queued after it.
      let body: string | undefined;
      try {
        body = action.body !== undefined ? JSON.stringify(action.body) : undefined;
      } catch {
        await removeAction(action.key);
        continue;
      }
      try {
        const res = await fetch(action.url, {
          method: action.method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body,
        });
        if (shouldDropAfterStatus(res.status)) await removeAction(action.key);
      } catch {
        break; // offline again mid-replay — stop, keep the rest queued for next time
      }
    }
  } finally {
    replaying = false;
  }
}
