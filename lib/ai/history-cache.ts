"use client";

import type { AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A LAST-KNOWN LIST, SO THE PAGE OPENS INSTEAD OF LOADING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "make the AI history to open and cache as instant as the
 * download history page does."
 *
 * ── 🔴 WHY THE DOWNLOAD HISTORY IS INSTANT AND THIS WAS NOT ────────────────
 *
 * They are not the same kind of page. Download history lives entirely in
 * `localStorage` and is read SYNCHRONOUSLY through `useSyncExternalStore`
 * (features/history/store.ts) — there is no request, so there is nothing to
 * wait for and no skeleton to show. AI history is server state: the jobs are
 * rows in Postgres, the files are in private storage, and a guest's list is
 * resolved from a signed cookie. It cannot simply move to localStorage.
 *
 * What it CAN do is remember what it last saw. So this is a snapshot, not a
 * store: the page paints the previous list on the very first frame and the
 * network answer replaces it a moment later. Stale-while-revalidate, with the
 * server still the only authority.
 *
 * ── 🔴 IT IS A CACHE OF A VIEW, NOT A SOURCE OF TRUTH ──────────────────────
 *
 * Nothing is ever DECIDED from this. It is not consulted for whether a video
 * exists, whether a link may be signed, or whether an allowance remains — those
 * are all re-resolved server-side on every request, exactly as before. A member
 * who edits this in devtools changes what their own screen shows for one frame
 * and nothing else.
 *
 * ⚠️ It holds the same class of thing the download history already keeps in
 * localStorage unconditionally: the member's own filenames, sizes and
 * timestamps. No signed URLs (those expire in minutes and are fetched on
 * demand), no storage paths, no tokens — `AiJobView` is already an allow-list
 * of what may leave the server.
 *
 * ── The TTL, and the one thing it protects against ─────────────────────────
 *
 * A shared device. localStorage is per-origin, not per-account, so a snapshot
 * written by one member is readable by the next one to sign in on that phone.
 * The revalidation replaces it within a moment, but "within a moment" is still
 * a frame of somebody else's filenames. A day's TTL bounds that, and
 * `clearAiHistoryCache` on sign-out closes it properly.
 */

const KEY = "frenzsave_ai_history_v1";
/** A snapshot older than this is thrown away rather than shown. */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Never persist more than one page — this is a first paint, not an archive. */
const MAX_ROWS = 12;

interface Snapshot {
  at: number;
  jobs: AiJobView[];
}

/**
 * The last list this browser saw, or null.
 *
 * 🔴 Safe to call during render. Every access is wrapped: a private window, a
 * browser with site data blocked, and a thumbnailer all THROW on
 * `localStorage`, and this must degrade to "no cache" rather than taking the
 * page down with it.
 */
export function readAiHistoryCache(): AiJobView[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed || !Array.isArray(parsed.jobs)) return null;
    if (!Number.isFinite(parsed.at) || Date.now() - parsed.at > TTL_MS) {
      // Expired. Removed now rather than left to be re-read and re-rejected on
      // every future visit.
      window.localStorage.removeItem(KEY);
      return null;
    }
    // A shape check, not a trust check: the value is the member's own and the
    // server overwrites it in a moment. This only stops a corrupted entry from
    // throwing inside a render.
    return parsed.jobs.filter((j) => j && typeof j.id === "string" && typeof j.status === "string");
  } catch {
    return null;
  }
}

export function writeAiHistoryCache(jobs: AiJobView[]): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: Snapshot = { at: Date.now(), jobs: jobs.slice(0, MAX_ROWS) };
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* quota, private mode, blocked storage — the page works without it */
  }
}

/** Called on sign-out. A snapshot must not outlive the session that made it. */
export function clearAiHistoryCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — the TTL is the backstop */
  }
}
