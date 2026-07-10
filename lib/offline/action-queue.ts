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

let replaying = false;

/**
 * Replays every queued action, oldest first. A network exception (still
 * offline, or went offline again mid-pass) stops the whole pass immediately,
 * keeping every remaining action queued in its original order for next time.
 */
export async function replayOfflineActions(): Promise<void> {
  if (replaying || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  replaying = true;
  try {
    const actions = (await listActions()).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const action of actions) {
      try {
        const res = await fetch(action.url, {
          method: action.method,
          headers: action.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: action.body !== undefined ? JSON.stringify(action.body) : undefined,
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
