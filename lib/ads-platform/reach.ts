import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdPageContext } from "./catalog";

/**
 * How much of the audience each ad placement reaches — MEASURED, never
 * invented (owner, 2026-10-09: "indicates all slots guarantees more reach to
 * audience, and show other slot and their percentage of audience reach";
 * AGENTS.md truth rule: a real measured number or nothing).
 *
 * Reach of a placement = the share of the last 30 days' page views that were
 * on a page where that placement appears (analytics_events, event_type
 * page_view). A placement on every page reaches 100 %; "All slots" covers every
 * page any slot covers. Below MIN_VIEWS the sample is too small to mean
 * anything, so no percentage is published at all.
 *
 * Counted in the database (head counts, one per content area) — no rows are
 * pulled into this function — and the answer is CDN-cached for an hour.
 */
export const REACH_WINDOW_DAYS = 30;
export const MIN_VIEWS = 200;

/** Which page paths each content area is (mirrors lib/ads-platform/pages.ts pageForPath). */
const AREA_PATHS: Record<Exclude<AdPageContext, "stories" | "ai_reels">, { exact?: string[]; prefix?: string[] }> = {
  download: { exact: ["/", "/downloads", "/library"] },
  download_result: { exact: ["/", "/downloads", "/library"] },
  feed: { exact: ["/feed"], prefix: ["/feed/"] },
  reels: { exact: ["/reels"], prefix: ["/reels/"] },
  ai: { exact: ["/ai", "/studio/ai"], prefix: ["/ai/", "/studio/ai/"] },
  history: { exact: ["/history"] },
};

export interface ReachAnswer {
  windowDays: number;
  /** null when there is not enough data to publish a percentage */
  placements: Record<string, number> | null;
  measuredAt: string;
}

type Db = SupabaseClient;

async function countViews(db: Db, since: string, area?: { exact?: string[]; prefix?: string[] }): Promise<number> {
  const base = () => db.from("analytics_events").select("event_id", { count: "exact", head: true }).eq("event_type", "page_view").gte("occurred_at", since);
  if (!area) return (await base()).count ?? 0;
  let n = 0;
  if (area.exact?.length) n += (await base().in("path", area.exact)).count ?? 0;
  for (const p of area.prefix ?? []) n += (await base().like("path", `${p}%`)).count ?? 0;
  return n;
}

export async function computeReach(db: Db, placements: { code: string; page_scope: string[] }[], now: number = Date.now()): Promise<ReachAnswer> {
  const since = new Date(now - REACH_WINDOW_DAYS * 86_400_000).toISOString();
  const measuredAt = new Date(now).toISOString();
  const total = await countViews(db, since);
  if (total < MIN_VIEWS) return { windowDays: REACH_WINDOW_DAYS, placements: null, measuredAt };

  const areaViews = new Map<string, number>();
  for (const [area, paths] of Object.entries(AREA_PATHS)) areaViews.set(area, await countViews(db, since, paths));

  const pct = (views: number) => Math.min(100, Math.round((views / total) * 100));
  const out: Record<string, number> = {};
  for (const p of placements) {
    if (p.page_scope.includes("all_pages")) {
      out[p.code] = 100;
      continue;
    }
    // the download and download-result areas are the same pages: count them once
    const areas = new Set(p.page_scope.map((a) => (a === "download_result" ? "download" : a)));
    let views = 0;
    for (const a of areas) views += areaViews.get(a) ?? 0;
    out[p.code] = pct(views);
  }
  return { windowDays: REACH_WINDOW_DAYS, placements: out, measuredAt };
}
