import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";

/**
 * The "top downloaders" leaderboard for admin Live activity — signed-in users
 * ranked 1..10 by how much they download, and WHAT they download most (owner:
 * "rank and see signed-in users by higher download and what they download more …
 * from 1 to 10 … anonymous doesn't get the same ranking").
 *
 * ── Signed-in only, by design ─────────────────────────────────────────────────
 *
 * Only rows with a `user_id` count. A guest download is `user_id = null` (see
 * lib/admin/activity.ts) and cannot be attributed to a person, so it never enters
 * the ranking — anonymous volume is returned separately as context, not a rank.
 *
 * ── Recent window, JS aggregate ───────────────────────────────────────────────
 *
 * There is no per-user aggregate view, and this is an operator page outside the
 * 2-second budget, so it aggregates a recent window of signed-in downloads in JS
 * rather than adding a migration/RPC. It is therefore a RECENT-activity ranking
 * (the most active downloaders lately), which is exactly what "live activity"
 * wants. Own tables only, service-role client, no cookies.
 */

const RECENT_WINDOW = 5000;

export interface TopDownloader {
  rank: number;
  /** Owner, 2026-08-26: a row must be clickable through to that member's full
   *  detail (downloads, streak, frequency) — that lookup is by id, not handle,
   *  since a handle can be null. */
  userId: string;
  handle: string | null;
  displayName: string;
  count: number;
  /** Their most-downloaded platform (display name), or null if unknown. */
  topPlatform: string | null;
  /** Their most-used format/kind (e.g. "MP4", "MP3"), or null. */
  topFormat: string | null;
}

export interface TopDownloadersResult {
  ranked: TopDownloader[];
  /** Downloads with no signed-in user in the window — shown as context, not ranked. */
  anonymousCount: number;
  /** How many signed-in downloads the ranking was computed over. */
  sampled: number;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function mode(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function platformName(id: string): string {
  return PLATFORMS[id as PlatformId]?.name ?? id;
}

export async function fetchTopDownloaders(): Promise<TopDownloadersResult> {
  const empty: TopDownloadersResult = { ranked: [], anonymousCount: 0, sampled: 0 };
  if (!hasSupabase) return empty;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("downloads")
      .select("user_id, platform, format")
      .order("created_at", { ascending: false })
      .limit(RECENT_WINDOW);

    const rows = (data ?? []) as { user_id: string | null; platform: string | null; format: string | null }[];

    let anonymousCount = 0;
    let sampled = 0;
    const byUser = new Map<
      string,
      { count: number; platforms: Map<string, number>; formats: Map<string, number> }
    >();

    for (const r of rows) {
      if (!r.user_id) {
        anonymousCount++;
        continue;
      }
      sampled++;
      const u =
        byUser.get(r.user_id) ??
        { count: 0, platforms: new Map<string, number>(), formats: new Map<string, number>() };
      u.count++;
      if (r.platform) u.platforms.set(r.platform, (u.platforms.get(r.platform) ?? 0) + 1);
      if (r.format) u.formats.set(r.format, (u.formats.get(r.format) ?? 0) + 1);
      byUser.set(r.user_id, u);
    }

    const top = [...byUser.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    // Resolve handles for the ranked users in one query.
    const ids = top.map(([id]) => id);
    const actorById = new Map<string, { handle: string | null; displayName: string }>();
    if (ids.length > 0) {
      const { data: profs } = await db
        .from("profiles")
        .select("id, handle, display_name")
        .in("id", ids);
      for (const p of (profs ?? []) as { id: string; handle: string | null; display_name: string | null }[]) {
        actorById.set(p.id, {
          handle: p.handle,
          displayName: p.display_name || (p.handle ? `@${p.handle}` : "Member"),
        });
      }
    }

    const ranked: TopDownloader[] = top.map(([id, u], i) => {
      const actor = actorById.get(id);
      const fmt = mode(u.formats);
      return {
        rank: i + 1,
        userId: id,
        handle: actor?.handle ?? null,
        displayName: actor?.displayName ?? "Member",
        count: u.count,
        topPlatform: (() => {
          const p = mode(u.platforms);
          return p ? platformName(p) : null;
        })(),
        topFormat: fmt ? fmt.toUpperCase() : null,
      };
    });

    return { ranked, anonymousCount, sampled };
  } catch {
    return empty;
  }
}
