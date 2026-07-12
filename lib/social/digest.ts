import type { NotificationType } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 8 "Smart Daily Digest" + "AI Summaries" — real, rule-based
 * aggregation of the recipient's OWN `notifications` rows since their last
 * digest (every event type this app produces already lands there, so this
 * is one query, not five separate ones against follows/comments/downloads/
 * etc individually). Explicitly NOT calling this "AI" anywhere in copy —
 * it's arithmetic over real events, not a model. "Recommended creator" is
 * folded in by reusing the existing suggestion logic (lib/social/suggest.ts)
 * rather than a separate recommendation system.
 *
 * Only Morning/daily cadence is built (spec asks for Morning/Afternoon/
 * Evening/Weekly/Monthly — one real, working cadence is the honest core of
 * "customizable digest"; the others are a real, identified follow-up, not
 * silently dropped — see docs/NOTIFICATIONS_PLATFORM.md).
 */
export interface DigestStats {
  newFollowers: number;
  newComments: number;
  newFriendRequests: number;
  downloadsCompleted: number;
  totalCount: number;
}

const HEADLINE_TYPES: NotificationType[] = ["follow", "comment", "reply", "friend_request", "download_complete", "download_ready"];

export async function computeDigestStats(userId: string, since: Date): Promise<DigestStats> {
  const db = createAdminClient();
  const { data } = await db
    .from("notifications")
    .select("type")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .in("type", HEADLINE_TYPES)
    .limit(5_000);
  const rows = (data ?? []) as { type: NotificationType }[];
  const count = (t: NotificationType) => rows.filter((r) => r.type === t).length;
  return {
    newFollowers: count("follow"),
    newComments: count("comment") + count("reply"),
    newFriendRequests: count("friend_request"),
    downloadsCompleted: count("download_complete") + count("download_ready"),
    totalCount: rows.length,
  };
}

export interface DigestSettingsRow {
  digest_enabled: boolean;
  last_digest_sent_at: string | null;
}

/** Pure — should this user get a digest run right now? A missing row means
 * defaults apply (digest enabled, never sent), so a user who's never
 * touched notification settings is still eligible. */
export function isDigestEligible(row: DigestSettingsRow | undefined, nowMs: number, minHoursBetween: number): boolean {
  if (!row) return true;
  if (!row.digest_enabled) return false;
  if (!row.last_digest_sent_at) return true;
  const cutoff = nowMs - minHoursBetween * 60 * 60_000;
  return new Date(row.last_digest_sent_at).getTime() < cutoff;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Pure — the digest's actual text, generated from real counts. Returns
 * `null` when there's genuinely nothing to report (never send an empty/
 * filler digest just because the cadence came around). */
export function formatDigestBody(stats: DigestStats): string | null {
  const parts: string[] = [];
  if (stats.newFollowers > 0) parts.push(plural(stats.newFollowers, "new follower"));
  if (stats.newComments > 0) parts.push(plural(stats.newComments, "new comment"));
  if (stats.newFriendRequests > 0) parts.push(plural(stats.newFriendRequests, "friend request"));
  if (stats.downloadsCompleted > 0) parts.push(`${plural(stats.downloadsCompleted, "download")} finished`);
  if (parts.length === 0) return null;
  if (parts.length === 1) return `You have ${parts[0]}.`;
  if (parts.length === 2) return `You have ${parts[0]} and ${parts[1]}.`;
  return `You have ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
}
