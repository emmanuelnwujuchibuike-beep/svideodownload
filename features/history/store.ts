import type { DownloadRecord } from "@/types";

/**
 * Tiny localStorage-backed store for download history, exposed through
 * `useSyncExternalStore` so the downloader and the history panel stay in sync
 * without a context provider. State lives client-side only (no account needed);
 * a Supabase-backed version can sync this later in Phase 2.
 */

const STORAGE_KEY = "svd:history:v1";
const MAX_ITEMS = 60;

let items: DownloadRecord[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) items = JSON.parse(raw) as DownloadRecord[];
  } catch {
    items = [];
  }
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
}

export function toggleFavorite(id: string): void {
  items = items.map((r) =>
    r.id === id ? { ...r, favorite: !r.favorite } : r,
  );
  persist();
  emit();
}

export function removeDownload(id: string): void {
  items = items.filter((r) => r.id !== id);
  persist();
  emit();
}

export function clearHistory(): void {
  items = [];
  persist();
  emit();
}
