/**
 * Playback links for AI results, kept until they expire (owner, 2026-10-06:
 * "never call server each time a user … view a video or audio").
 *
 * A result plays from a short-lived SIGNED storage URL that the server mints
 * on request. Asking for a fresh one every time a member re-opens the same
 * video was a server call per view. The link is valid for `expiresIn`
 * seconds, so it is kept here (sessionStorage — it is a credential-bearing
 * URL, so it never outlives the tab) and reused until a minute before it
 * expires. After that the next view asks once, as before.
 *
 * Download links are NOT cached: they carry a different disposition and are
 * asked for at the moment somebody presses Download.
 */

import { AI_MEDIA_URLS_KEY } from "@/lib/ai/device-keys";

const KEY = AI_MEDIA_URLS_KEY;
const MARGIN_MS = 60_000;

type Entry = { url: string; until: number };

function read(): Record<string, Entry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, Entry>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage refused — the next view simply asks again */
  }
}

/** A still-valid playback link for this key, or null. */
export function cachedMediaUrl(key: string, now = Date.now()): string | null {
  const hit = read()[key];
  return hit && hit.until - MARGIN_MS > now ? hit.url : null;
}

export function rememberMediaUrl(key: string, url: string, expiresInSeconds: number, now = Date.now()): void {
  if (!url || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return;
  const map = read();
  // drop the expired while we are here, so the map never grows without bound
  for (const [k, v] of Object.entries(map)) if (v.until <= now) delete map[k];
  map[key] = { url, until: now + expiresInSeconds * 1000 };
  write(map);
}

export function clearMediaUrlCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
