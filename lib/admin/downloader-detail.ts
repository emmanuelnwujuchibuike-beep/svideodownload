import "server-only";

import { getUserPlan } from "@/lib/monetization/plan";
import { PLATFORMS } from "@/lib/platforms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformId } from "@/types";

/**
 * The full profile behind ONE row of the Top downloaders leaderboard.
 *
 * Owner, 2026-08-26: "signed in top downloader in live activity, should be
 * clickable to see full details of that users download, streaks, and how many
 * times a day or week and all information about that user."
 *
 * The leaderboard itself (`lib/admin/top-downloaders.ts`) ranks over a
 * RECENT, capped window (5000 rows) — right for "who is active lately", wrong
 * for "how much has this person downloaded, total". Everything here is scoped
 * to ONE user_id, so it can afford to be exact: real counts, not a sample.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** How far back the per-day frequency breakdown reaches. */
const FREQUENCY_WINDOW_DAYS = 30;
/** How many of the most recent downloads to list in full. */
const RECENT_LIMIT = 20;
/** Upper bound on rows pulled for the frequency/breakdown computation — a
 *  single very prolific user's history, not the whole table. */
const HISTORY_SCAN_CAP = 5000;

export interface DownloaderProfile {
  userId: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  isSuspended: boolean;
  plan: string;
  joinedAt: string | null;
  trustScore: number | null;
}

export interface DownloaderStreak {
  current: number;
  longest: number;
  lastActivityDate: string | null;
  totalActiveDays: number;
  startedAt: string | null;
}

export interface DownloaderRecentItem {
  id: string;
  title: string | null;
  sourceUrl: string;
  platform: string;
  format: string | null;
  status: string;
  createdAt: string;
}

export interface DownloaderDayCount {
  date: string; // YYYY-MM-DD, UTC
  count: number;
}

export interface DownloaderDetail {
  profile: DownloaderProfile;
  streak: DownloaderStreak | null;
  /** Exact, all-time — not a sample. */
  totalDownloads: number;
  today: number;
  last7: number;
  last30: number;
  /** total downloads in the scanned window / distinct active days in it. */
  avgPerActiveDay: number;
  byPlatform: { platform: string; count: number }[];
  byFormat: { format: string; count: number }[];
  /** Last {@link FREQUENCY_WINDOW_DAYS} days, oldest first, gap-free (0 for a
   *  day with no downloads). */
  dailyFrequency: DownloaderDayCount[];
  recent: DownloaderRecentItem[];
  /** True if the scan for byPlatform/byFormat/dailyFrequency/avgPerActiveDay
   *  hit HISTORY_SCAN_CAP — those figures cover only the most recent
   *  HISTORY_SCAN_CAP downloads, not this user's whole history. totalDownloads
   *  is unaffected (it's a separate exact count query). */
  scanCapped: boolean;
}

function platformName(id: string): string {
  return PLATFORMS[id as PlatformId]?.name ?? id;
}

function isoDayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function topN(counts: Map<string, number>, n: number): { key: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

/**
 * `downloads.format` is a PACKED string — formatId~|~kind~|~qualityLabel~|~
 * size~|~status~|~failureReason (see features/history/sync.ts, which writes
 * it). Verified live 2026-08-26 against a real row: `"TT-SD~|~VIDEO~|~HD ·
 * NO WATERMARK~|~2285689~|~~|~"`.
 *
 * 🔴 Using the raw string as either a display value or a GROUPING KEY is
 * wrong either way it's used: `size` (field 4) differs on nearly every
 * download, so grouping by the raw string put almost every download in its
 * own one-off bucket instead of a meaningful "HD" / "MP4" group — caught by
 * running this function against real data before shipping it, not by reading
 * the schema. The human label is the quality field; format id or kind cover
 * the rare row where quality wasn't recorded.
 */
export function formatLabel(raw: string | null): string | null {
  if (!raw) return null;
  const [formatId, kind, qualityLabel] = raw.split("~|~");
  const label = qualityLabel || kind || formatId;
  return label ? label.toUpperCase() : null;
}

export async function fetchDownloaderDetail(userId: string): Promise<DownloaderDetail | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();

    const [{ data: profileRow }, { data: streakRow }, { count: totalDownloads }, { data: historyRows }, plan] =
      await Promise.all([
        db
          .from("profiles")
          .select("id, handle, display_name, avatar_url, is_verified, is_suspended, created_at, trust_score")
          .eq("id", userId)
          .maybeSingle(),
        db
          .from("streaks")
          .select("current_streak, longest_streak, last_activity_date, total_active_days, streak_started_at")
          .eq("user_id", userId)
          .maybeSingle(),
        db.from("downloads").select("id", { count: "exact", head: true }).eq("user_id", userId),
        db
          .from("downloads")
          .select("id, title, source_url, platform, format, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_SCAN_CAP),
        // The real, billed plan — `profiles` has no `plan` column. Same
        // resolution every other monetization-aware surface uses (subscription
        // row, with the active-promo override), so this never disagrees with
        // what the member is actually charged.
        getUserPlan(userId),
      ]);

    if (!profileRow) return null;
    const p = profileRow as {
      id: string;
      handle: string | null;
      display_name: string | null;
      avatar_url: string | null;
      is_verified: boolean;
      is_suspended: boolean;
      created_at: string | null;
      trust_score: number | null;
    };

    const rows = (historyRows ?? []) as {
      id: string;
      title: string | null;
      source_url: string;
      platform: string | null;
      format: string | null;
      status: string;
      created_at: string;
    }[];
    const scanCapped = rows.length >= HISTORY_SCAN_CAP;

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const day7 = new Date(now - 7 * 86_400_000).toISOString();
    const day30 = new Date(now - 30 * 86_400_000).toISOString();

    let today = 0;
    let last7 = 0;
    let last30 = 0;
    const platforms = new Map<string, number>();
    const formats = new Map<string, number>();
    const activeDays = new Set<string>();
    const dayCounts = new Map<string, number>();

    for (const r of rows) {
      if (r.created_at >= todayStart.toISOString()) today++;
      if (r.created_at >= day7) last7++;
      if (r.created_at >= day30) last30++;
      if (r.platform) platforms.set(r.platform, (platforms.get(r.platform) ?? 0) + 1);
      const fmt = formatLabel(r.format);
      if (fmt) formats.set(fmt, (formats.get(fmt) ?? 0) + 1);
      const day = r.created_at.slice(0, 10);
      activeDays.add(day);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    // Gap-free grid for the last FREQUENCY_WINDOW_DAYS, oldest first — a day
    // with zero downloads is a real zero, not a missing point (this scan is
    // over the user's own recent history, never row-capped away for a window
    // this short unless they downloaded HISTORY_SCAN_CAP times in 30 days).
    const dailyFrequency: DownloaderDayCount[] = [];
    for (let i = FREQUENCY_WINDOW_DAYS - 1; i >= 0; i--) {
      const d = new Date(todayStart.getTime() - i * 86_400_000);
      const key = isoDayUtc(d);
      dailyFrequency.push({ date: key, count: dayCounts.get(key) ?? 0 });
    }

    const avgPerActiveDay = activeDays.size > 0 ? rows.length / activeDays.size : 0;

    return {
      profile: {
        userId: p.id,
        handle: p.handle,
        displayName: p.display_name || (p.handle ? `@${p.handle}` : "Member"),
        avatarUrl: p.avatar_url,
        isVerified: !!p.is_verified,
        isSuspended: !!p.is_suspended,
        plan,
        joinedAt: p.created_at,
        trustScore: p.trust_score,
      },
      streak: streakRow
        ? {
            current: (streakRow as { current_streak: number }).current_streak ?? 0,
            longest: (streakRow as { longest_streak: number }).longest_streak ?? 0,
            lastActivityDate: (streakRow as { last_activity_date: string | null }).last_activity_date,
            totalActiveDays: (streakRow as { total_active_days: number }).total_active_days ?? 0,
            startedAt: (streakRow as { streak_started_at: string | null }).streak_started_at,
          }
        : null,
      totalDownloads: totalDownloads ?? rows.length,
      today,
      last7,
      last30,
      avgPerActiveDay,
      byPlatform: topN(platforms, 6).map(({ key, count }) => ({ platform: platformName(key), count })),
      // Already the decoded, uppercased label — see formatLabel.
      byFormat: topN(formats, 6).map(({ key, count }) => ({ format: key, count })),
      dailyFrequency,
      recent: rows.slice(0, RECENT_LIMIT).map((r) => ({
        id: r.id,
        title: r.title,
        sourceUrl: r.source_url,
        platform: platformName(r.platform ?? "generic"),
        format: formatLabel(r.format),
        status: r.status,
        createdAt: r.created_at,
      })),
      scanCapped,
    };
  } catch {
    return null;
  }
}
