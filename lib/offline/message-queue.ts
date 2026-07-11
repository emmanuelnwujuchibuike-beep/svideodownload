/**
 * Offline message send queue. Deliberately a SEPARATE store from
 * `action-queue.ts` — that one is scoped to idempotent, replace-by-key
 * toggles (Like/Save), where only the LATEST desired state matters; a
 * message is a distinct, ordered, non-collapsible item — queuing two
 * messages must send BOTH, in order, not replace one with the other.
 *
 * Each queued message carries a client-generated `clientId` (also its
 * IndexedDB keyPath) that doubles as the server's idempotency key
 * (see lib/social/messages.ts's `sendMessage` + migration 0043's unique
 * index) — replaying the same queued item twice (a race between two
 * `online` events, e.g.) is always safe.
 *
 * Real exponential backoff between retries (not just "try again next
 * reconnect event"): each item tracks its own `nextRetryAt`, skipped by
 * the replay pass until due. A 4xx response is treated as permanent
 * (mirrors `shouldDropAfterStatus` in action-queue.ts); a 5xx or network
 * failure counts as one attempt and backs off; after MAX_ATTEMPTS the item
 * is dropped from the active queue and best-effort logged to
 * `message_send_failures` (migration 0043) so it's a real, queryable
 * number in the monitoring view, not a silently-vanished message.
 */

const DB_NAME = "frenz-message-queue";
const STORE = "messages";
const DB_VERSION = 1;
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface QueuedMessage {
  clientId: string;
  conversationId: string;
  body: string;
  replyToId?: string;
  /** Cached so a re-seeded bubble (see conversation-room.tsx's queue effect)
   * can show the SAME quoted-reply preview after a remount, instead of the
   * quote silently vanishing until the send actually confirms. */
  replyToPreview?: { id: string; body: string; senderId: string; deleted: boolean };
  clientSentAt: string;
  queuedAt: number;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: "clientId" });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
export function subscribeMessageQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A permanent failure REMOVES the item from the queue (same as a success) —
// `subscribeMessageQueue` alone can't tell "sent" apart from "gave up" once
// the item is gone. This is the specific signal for the latter, so a
// mounted thread can show "Failed — tap to retry" instead of the bubble
// just silently vanishing.
const failureListeners = new Set<(clientId: string) => void>();
function emitFailure(clientId: string) {
  for (const l of failureListeners) l(clientId);
}
export function subscribeMessageFailure(listener: (clientId: string) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

export async function enqueueMessage(msg: {
  clientId: string;
  conversationId: string;
  body: string;
  replyToId?: string;
  replyToPreview?: { id: string; body: string; senderId: string; deleted: boolean };
  clientSentAt: string;
}): Promise<void> {
  try {
    const db = await openDb();
    const record: QueuedMessage = { ...msg, queuedAt: Date.now(), attempts: 0, nextRetryAt: 0 };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    emit();
  } catch {
    /* IndexedDB unavailable — the send just goes through the normal
       (non-offline) path and fails visibly, same as before this existed */
  }
}

async function listAll(): Promise<QueuedMessage[]> {
  const db = await openDb();
  const items = await new Promise<QueuedMessage[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedMessage[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return items;
}

async function remove(clientId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function update(record: QueuedMessage): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueuedForConversation(conversationId: string): Promise<QueuedMessage[]> {
  try {
    const all = await listAll();
    return all.filter((m) => m.conversationId === conversationId).sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

async function logFailure(msg: QueuedMessage, reason: string): Promise<void> {
  try {
    await fetch("/api/messages/send-failures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: msg.conversationId, clientId: msg.clientId, reason, attempts: msg.attempts }),
    });
  } catch {
    /* best-effort telemetry only */
  }
}

let replaying = false;

/**
 * Replays every due queued message, oldest first, per conversation order
 * preserved. A network exception stops the WHOLE pass (still offline) —
 * everything else stays queued for next time. A per-item 5xx/exception
 * only backs THAT item off; other conversations' queued messages still get
 * their turn in the same pass.
 */
export async function replayMessageQueue(): Promise<void> {
  if (replaying || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  replaying = true;
  try {
    const all = await listAll();
    const now = Date.now();
    const due = all.filter((m) => m.nextRetryAt <= now).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const msg of due) {
      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: msg.conversationId,
            body: msg.body,
            replyToId: msg.replyToId,
            clientId: msg.clientId,
            clientSentAt: msg.clientSentAt,
          }),
        });
        if (res.ok) {
          await remove(msg.clientId);
          emit();
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          // Permanent (blocked/invalid/gone) — retrying can never succeed.
          await logFailure(msg, `http_${res.status}`);
          await remove(msg.clientId);
          emit();
          emitFailure(msg.clientId);
          continue;
        }
        // 5xx — transient, back off and try again later.
        const attempts = msg.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await logFailure(msg, `max_attempts_http_${res.status}`);
          await remove(msg.clientId);
          emit();
          emitFailure(msg.clientId);
        } else {
          await update({ ...msg, attempts, nextRetryAt: Date.now() + backoffMs(attempts), lastError: `http_${res.status}` });
          emit();
        }
      } catch {
        // Network exception — genuinely offline again mid-pass. Don't count
        // this as an attempt against the message (not its fault); stop the
        // whole pass so message ORDER is preserved for the next try.
        break;
      }
    }
  } finally {
    replaying = false;
  }
}
