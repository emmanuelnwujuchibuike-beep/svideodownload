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
const MAX_ITEMS = 60;

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
  items = merged
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS);
  persist();
  emit();
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — keep in-memory only */
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
  items = [
    next,
    ...items.filter((r) => r.id !== next.id),
  ].slice(0, MAX_ITEMS);
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
