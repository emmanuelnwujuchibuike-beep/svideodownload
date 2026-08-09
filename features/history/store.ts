import type { DownloadRecord } from "@/types";

import {
  fetchRemote,
  pushAdd,
  pushClear,
  pushFavorite,
  pushRemove,
  remoteId,
} from "./sync";

/**
 * localStorage-backed download-history store, exposed through
 * `useSyncExternalStore`. When the visitor is signed in, history is also mirrored
 * to Supabase (see ./sync) so it follows them across devices; logged-out users
 * keep a purely local history.
 */

const STORAGE_KEY = "svd:history:v1";

/**
 * History is NEVER trimmed on its own (owner, 2026-08-09): "history should
 * never clear or delete on its own, unless a user deletes or clears it
 * manually."
 *
 * It used to be capped at 60 and sliced on every add, so a member's 61st
 * download silently destroyed their first — with no warning, no undo, and
 * nothing in the UI to suggest it had happened. A cap that deletes a person's
 * own records to save a few kilobytes is the wrong trade in every direction.
 *
 * The in-memory list is now unbounded. Only `persist` deals with the browser's
 * storage quota, and it does so WITHOUT touching what is on screen — see below.
 */
const PERSIST_FLOOR = 50;

let items: DownloadRecord[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

let remoteSynced = false;

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) items = JSON.parse(raw) as DownloadRecord[];
  } catch {
    items = [];
  }
  void syncFromRemote();
}

/** Pulls the signed-in user's history and merges it with the local cache. */
async function syncFromRemote(): Promise<void> {
  if (remoteSynced) return;
  remoteSynced = true;
  const remote = await fetchRemote();
  if (remote.length === 0) return;

  const key = (r: DownloadRecord) => `${r.url}|${r.formatId}|${r.kind}`;
  const seen = new Set(items.map(key));
  const merged = [...items];
  for (const r of remote) {
    if (!seen.has(key(r))) {
      merged.push(r);
      seen.add(key(r));
    }
  }
  items = merged.sort((a, b) => b.createdAt - a.createdAt);
  persist();
  emit();
}

/**
 * Write to localStorage, degrading gracefully instead of losing records.
 *
 * The full list is tried first. If the browser refuses it — quota, private
 * mode — progressively fewer of the NEWEST entries are written until one
 * succeeds. Crucially this never touches `items`: what is on screen stays
 * complete for the session, and only what survives a reload is reduced.
 *
 * That is the honest failure: the browser physically cannot store more, so
 * something must give, and it should be the oldest rather than the newest. It
 * takes tens of thousands of records to reach that point.
 */
function persist(): void {
  if (typeof window === "undefined") return;
  let count = items.length;
  for (;;) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, count)));
      return;
    } catch {
      if (count <= PERSIST_FLOOR) return; // private mode — in-memory only
      count = Math.max(PERSIST_FLOOR, Math.floor(count / 2));
    }
  }
}

export function subscribe(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): DownloadRecord[] {
  load();
  return items;
}

/** Stable empty array so SSR snapshots don't trigger re-render loops. */
const EMPTY: DownloadRecord[] = [];
export function getServerSnapshot(): DownloadRecord[] {
  return EMPTY;
}

export function addDownload(
  record: Omit<DownloadRecord, "id" | "createdAt" | "favorite">,
): void {
  load();
  const id = crypto.randomUUID();
  // De-duplicate by url+format+kind, preserving any existing favorite flag.
  const existing = items.find(
    (r) =>
      r.url === record.url &&
      r.formatId === record.formatId &&
      r.kind === record.kind,
  );
  const next: DownloadRecord = {
    ...record,
    id: existing?.id ?? id,
    createdAt: Date.now(),
    favorite: existing?.favorite ?? false,
  };
  items = [next, ...items.filter((r) => r.id !== next.id)];
  persist();
  emit();

  // Mirror to Supabase (best-effort); on success adopt the remote id so later
  // favourite/remove operations sync too.
  void pushAdd(next).then((rid) => {
    if (!rid) return;
    items = items.map((r) => (r.id === next.id ? { ...r, id: rid } : r));
    persist();
    emit();
  });
}

export function toggleFavorite(id: string): void {
  let favorite = false;
  items = items.map((r) =>
    r.id === id ? ((favorite = !r.favorite), { ...r, favorite }) : r,
  );
  persist();
  emit();
  const dbId = remoteId(id);
  if (dbId) void pushFavorite(dbId, favorite);
}

export function removeDownload(id: string): void {
  items = items.filter((r) => r.id !== id);
  persist();
  emit();
  const dbId = remoteId(id);
  if (dbId) void pushRemove(dbId);
}

export function clearHistory(): void {
  items = [];
  persist();
  emit();
  void pushClear();
}
