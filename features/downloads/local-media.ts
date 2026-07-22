"use client";

import { downloadUrl } from "@/lib/client-download";
import { getSyncConditions } from "@/lib/media/network-conditions";
import type { MediaKind } from "@/types";

/**
 * On-device library of downloaded media (IndexedDB). Lets users re-watch their
 * downloads in the browser without re-fetching or visiting the source platform,
 * and provides the blob when they choose to publish it for everyone.
 */

const DB_NAME = "frenz-media";
const STORE = "blobs";

/**
 * A small in-memory cache in FRONT of IndexedDB.
 *
 * A just-finished download is saved to IndexedDB, but reading it straight back
 * out for the "Review video" player still costs an async DB round-trip — enough
 * to flash a loader. Keeping the last few blobs in memory lets the player replay
 * them instantly (no DB read, no loading state), which is the "open and play
 * instantly" the owner asked for. Bounded so it can never grow unbounded.
 */
const memoryCache = new Map<string, Blob>();
const MEMORY_MAX = 4;
function warmMemory(key: string, blob: Blob): void {
  memoryCache.set(key, blob);
  while (memoryCache.size > MEMORY_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

/** Stable key for a download (matches the history dedupe key). */
export function mediaKey(url: string, formatId: string, kind: MediaKind): string {
  return `${url}|${formatId}|${kind}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveMedia(key: string, blob: Blob): Promise<void> {
  warmMemory(key, blob); // instant replay for the just-downloaded file
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getMedia(key: string): Promise<Blob | null> {
  const warm = memoryCache.get(key);
  if (warm) return warm; // instant path — no IndexedDB round-trip
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function hasMedia(key: string): Promise<boolean> {
  return (await getMedia(key)) !== null;
}

/**
 * The main downloader hands the file straight to the browser's native download
 * manager (`downloadToDisk` — a raw anchor click, the only reliable path on
 * iOS Safari) so the app never receives a Blob to cache from that path. Left
 * as-is, re-opening that same download from Continue Watching/History always
 * misses the cache and re-fetches the whole file from the network again,
 * every time.
 *
 * This warms the cache with a second, independent, best-effort background
 * fetch so a later re-open plays instantly — the same instant-open feel Reels
 * already has. Skipped entirely on a constrained connection (Data Saver /
 * 2G/3G) since it's a real second full download of the file, not free; never
 * blocks or delays the native save, and any failure here is silent (the real
 * download already succeeded independently via the anchor).
 */
export async function warmMediaCache(payload: { url: string; formatId: string; kind: MediaKind; title?: string }): Promise<void> {
  const key = mediaKey(payload.url, payload.formatId, payload.kind);
  if (await hasMedia(key)) return;
  const { saveData, effectiveType } = getSyncConditions();
  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") return;
  try {
    const res = await fetch(downloadUrl(payload));
    if (!res.ok) return;
    const blob = await res.blob();
    await saveMedia(key, blob);
  } catch {
    /* best-effort — the real download already happened via the native path */
  }
}

export async function deleteMedia(key: string): Promise<void> {
  memoryCache.delete(key);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
