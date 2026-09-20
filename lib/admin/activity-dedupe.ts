/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE DOWNLOAD, ONE ROW IN THE FEED — the pairing rule, shared by both ends
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "the admin live activity shows duplicate real-time
 * activity … signed-in and anonymous should never give a duplicate activity."
 * Owner, 2026-08-16: "signed users who make download should show the user's
 * name and download details alone and not include a duplicate anonymous
 * download."
 *
 * ── Why there are two rows for one download at all ──────────────────────────
 * `server/services/analytics.ts`'s `recordDownloadEvent` inserts an ANONYMOUS
 * `downloads` row the instant `/api/download` is called — before the transfer
 * has started, and with no `user_id` because that route never resolves one
 * (an auth round-trip on the hottest path in the app, to fix an admin display,
 * is the wrong trade). If the visitor is signed in, `features/history/sync.ts`
 * inserts a SECOND, fully attributed row once the file actually finishes
 * client-side. Both rows are honest on their own; together they are one event
 * shown twice, once unnamed.
 *
 * ── Why the rule lives HERE, pure, and runs in TWO places ────────────────────
 * The server reader (`lib/admin/activity.ts`) paired the rows inside one
 * fetch, and that was enough for a page load. It was NOT enough for the live
 * feed, which polls with a `?since=` cursor: the anonymous row arrives in one
 * poll (the moment the download starts) and the attributed one a poll or two
 * later (when it finishes), so the two were never in the same response and
 * the feed showed both until the next full reload. The pairing therefore has
 * to run over what the BROWSER is holding as well — the same function, so the
 * two ends can never disagree about what a duplicate is.
 *
 * ── The matching rule ────────────────────────────────────────────────────────
 * Same `sourceUrl`, one row anonymous and one attributed, within a generous
 * 20-minute window (large files — Telegram in particular — take a while to
 * finish). Paired 1:1 by nearest timestamp within each `sourceUrl` group, not
 * "any anonymous row near any attributed one", so two different people
 * downloading the same viral link around the same time are never merged, and
 * a story that expands into nine files keeps nine rows. The ANONYMOUS row of
 * each matched pair is dropped; the attributed one — which also carries the
 * real format/quality, not just a media-kind guess — is kept.
 *
 * Pure: no imports, so both `"use client"` and `server-only` modules can use it.
 */

export const DOWNLOAD_PAIR_WINDOW_MS = 20 * 60_000;

export interface PairableItem {
  id: string;
  kind: string;
  /** Null = anonymous / no signed-in user. */
  actor: { handle: string } | null;
  at: string;
  meta: Record<string, unknown> | null;
}

/** Attributed = a member behind it, whether or not their profile resolved to a handle. */
function attributed(i: PairableItem): boolean {
  return i.actor !== null || typeof i.meta?.memberId === "string";
}

function sourceOf(i: PairableItem): string | null {
  const s = i.meta?.sourceUrl;
  return typeof s === "string" && s.length > 0 ? s : null;
}

/**
 * Drop the anonymous half of every (anonymous, attributed) download pair.
 * Every non-download item, and every download with no source URL, passes
 * through untouched. Order is preserved.
 */
export function collapseDownloadPairs<T extends PairableItem>(items: readonly T[]): T[] {
  const bySource = new Map<string, T[]>();
  for (const i of items) {
    if (i.kind !== "download") continue;
    const key = sourceOf(i);
    if (!key) continue; // no source URL on file → never merge it
    const list = bySource.get(key);
    if (list) list.push(i);
    else bySource.set(key, [i]);
  }

  const drop = new Set<string>();
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    const anon = group.filter((i) => !attributed(i)).sort((a, b) => a.at.localeCompare(b.at));
    const named = group.filter(attributed).sort((a, b) => a.at.localeCompare(b.at));
    if (anon.length === 0 || named.length === 0) continue;

    const used = new Set<string>();
    for (const a of anon) {
      const aTime = Date.parse(a.at);
      let best: T | null = null;
      let bestDelta = Infinity;
      for (const u of named) {
        if (used.has(u.id)) continue;
        const delta = Math.abs(Date.parse(u.at) - aTime);
        if (delta <= DOWNLOAD_PAIR_WINDOW_MS && delta < bestDelta) {
          best = u;
          bestDelta = delta;
        }
      }
      if (best) {
        used.add(best.id);
        drop.add(a.id);
      }
    }
  }

  return drop.size === 0 ? [...items] : items.filter((i) => !drop.has(i.id));
}
