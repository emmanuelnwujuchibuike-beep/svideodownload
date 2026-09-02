import "server-only";

import { computeTrends, type Trend } from "@/lib/profile/growth";
import { categoryLabel } from "@/lib/social/categories";
import { listSnapshots } from "@/lib/social/profile-backends";
import { createAdminClient } from "@/lib/supabase/admin";

import { hourHistogram, peakHour } from "./retention";

/**
 * Audience insights (Feature 15 · Part 9).
 *
 * ── What is NOT here, and why ────────────────────────────────────────────
 * The brief asks for age groups, countries, cities, languages and devices.
 * None of them exist anywhere in this product and none can be derived:
 *
 *   · A view is identified by `viewer_id` or a HASHED ip and is never resolved
 *     to a location — deliberately, and documented as such since Part 8.
 *   · `profiles` has no birthdate, so there is no age to group by.
 *   · Nothing records a user-agent, device class or locale against a view.
 *
 * Producing any of those charts would mean inventing the numbers, which this
 * project has declined three times. So the honest slice of "who is watching"
 * is built instead, out of signals that do exist: WHEN they watch, whether they
 * COME BACK, and — with a cohort floor — what else they are interested in.
 *
 * ── Viewing times is the genuinely new one ──────────────────────────────
 * `post_watch_events.created_at` is a real timestamp on a real watch. Bucketed
 * by hour it answers "when is my audience actually here", which is both the
 * most actionable audience fact available and the input to the assistant's
 * upload-time suggestion.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Watch rows scanned per audience read. Far below PostgREST's 1000-row
 *  truncation point per request — this pages deliberately rather than trusting
 *  a single large read not to be silently cut. */
const WATCH_PAGE = 1000;
const WATCH_PAGES = 20;

/**
 * 🔴 Below this many followers, aggregate interest data is suppressed entirely.
 * With three followers, "your audience likes gaming" is not an aggregate — it
 * names an individual's private interest profile to somebody else.
 */
export const MIN_INTEREST_COHORT = 5;

export interface AudienceInsights {
  trends: Trend[];
  /** True when there are fewer than two daily readings — no trend may be drawn. */
  insufficientHistory: boolean;
  /** 24 buckets in the creator's own timezone offset. */
  viewingHours: number[];
  peakHour: number | null;
  returningViewers: number;
  oneTimeViewers: number;
  /** Identified viewers who watched on 3+ distinct days. */
  loyalFans: number;
  newFollowers7d: number;
  newFollowers30d: number;
  /** Aggregated from followers' own interest profiles, or null when the cohort
   *  is too small to aggregate without exposing an individual. */
  interests: { category: string; label: string; weight: number }[] | null;
  interestCohort: number;
  /** Rows the watch scan could not fit — reported, never silently dropped. */
  watchSampleTruncated: boolean;
}

const EMPTY: AudienceInsights = {
  trends: [],
  insufficientHistory: true,
  viewingHours: new Array<number>(24).fill(0),
  peakHour: null,
  returningViewers: 0,
  oneTimeViewers: 0,
  loyalFans: 0,
  newFollowers7d: 0,
  newFollowers30d: 0,
  interests: null,
  interestCohort: 0,
  watchSampleTruncated: false,
};

interface WatchRow {
  viewer_id: string | null;
  ip_hash: string | null;
  created_at: string;
}

/**
 * @param utcOffsetMinutes The creator's own offset, so "9pm" on the chart means
 *   9pm where they are. Passed in from the client rather than guessed: the
 *   server has no idea where the creator is, and rendering UTC hours under a
 *   local label would be a quietly wrong chart.
 */
export async function getAudienceInsights(
  userId: string,
  utcOffsetMinutes = 0,
): Promise<AudienceInsights> {
  if (!hasSupabase) return EMPTY;

  try {
    const db = createAdminClient();

    const { data: postRows } = await db
      .from("posts")
      .select("id")
      .eq("publisher_id", userId)
      .neq("status", "removed")
      .limit(1000);
    const postIds = ((postRows ?? []) as { id: string }[]).map((p) => p.id);

    const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

    const [snapshots, f7, f30] = await Promise.all([
      listSnapshots(userId, 60),
      db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("following_id", userId).gte("created_at", since(7)),
      db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("following_id", userId).gte("created_at", since(30)),
    ]);

    const trends = computeTrends(snapshots);

    const hours: number[] = [];
    let truncated = false;
    // identity -> set of days they watched on
    const daysByViewer = new Map<string, Set<string>>();

    if (postIds.length > 0) {
      for (let page = 0; page < WATCH_PAGES; page += 1) {
        const from = page * WATCH_PAGE;
        const { data } = await db
          .from("post_watch_events")
          .select("viewer_id, ip_hash, created_at")
          .in("post_id", postIds)
          .gte("created_at", since(90))
          .order("created_at", { ascending: false })
          .range(from, from + WATCH_PAGE - 1);

        const rows = (data ?? []) as WatchRow[];
        for (const r of rows) {
          const at = new Date(r.created_at);
          if (!Number.isNaN(at.getTime())) {
            const local = new Date(at.getTime() + utcOffsetMinutes * 60_000);
            hours.push(local.getUTCHours());
          }
          // An anonymous watch still has an identity for this purpose — the
          // same hashed IP twice is the same person coming back, as far as
          // anything in this product can tell. It is never resolved further.
          const identity = r.viewer_id ?? (r.ip_hash ? `ip:${r.ip_hash}` : null);
          if (identity) {
            const day = r.created_at.slice(0, 10);
            const set = daysByViewer.get(identity);
            if (set) set.add(day);
            else daysByViewer.set(identity, new Set([day]));
          }
        }
        if (rows.length < WATCH_PAGE) break;
        if (page === WATCH_PAGES - 1) truncated = true;
      }
    }

    let returning = 0;
    let oneTime = 0;
    let loyal = 0;
    for (const days of daysByViewer.values()) {
      if (days.size >= 3) loyal += 1;
      if (days.size >= 2) returning += 1;
      else oneTime += 1;
    }

    const buckets = hourHistogram(hours);
    const { interests, cohort } = await getAudienceInterests(db, userId);

    return {
      trends,
      insufficientHistory: trends.length === 0,
      viewingHours: buckets,
      peakHour: peakHour(buckets),
      returningViewers: returning,
      oneTimeViewers: oneTime,
      loyalFans: loyal,
      newFollowers7d: f7.count ?? 0,
      newFollowers30d: f30.count ?? 0,
      interests,
      interestCohort: cohort,
      watchSampleTruncated: truncated,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * What this creator's followers are interested in, aggregated from their own
 * FrenzDNA profiles (migration 0133).
 *
 * 🔴 Suppressed below MIN_INTEREST_COHORT followers. `user_interest_profile` is
 * private, per-person data whose RLS restricts reads to its owner; the service
 * role can read it, which makes the cohort floor the only thing standing
 * between "audience insight" and "here is what your one follower is into".
 */
async function getAudienceInterests(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ interests: AudienceInsights["interests"]; cohort: number }> {
  try {
    const { data: followerRows } = await db
      .from("follows")
      .select("follower_id")
      .eq("following_id", userId)
      .limit(500);
    const followerIds = ((followerRows ?? []) as { follower_id: string }[]).map((f) => f.follower_id);
    if (followerIds.length < MIN_INTEREST_COHORT) return { interests: null, cohort: followerIds.length };

    const { data } = await db
      .from("user_interest_profile")
      .select("user_id, category, weight")
      .in("user_id", followerIds)
      .limit(1000);

    const rows = (data ?? []) as { user_id: string; category: string; weight: number }[];
    const contributors = new Set(rows.map((r) => r.user_id));
    // The floor applies to who actually CONTRIBUTED, not to who follows: five
    // followers of whom one has an interest profile is still a cohort of one.
    if (contributors.size < MIN_INTEREST_COHORT) return { interests: null, cohort: contributors.size };

    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.category, (totals.get(r.category) ?? 0) + (r.weight ?? 0));

    const max = Math.max(...totals.values(), 1);
    const interests = [...totals.entries()]
      .map(([category, sum]) => ({ category, label: categoryLabel(category), weight: sum / max }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);

    return { interests, cohort: contributors.size };
  } catch {
    return { interests: null, cohort: 0 };
  }
}
