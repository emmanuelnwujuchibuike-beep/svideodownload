import { publishNotification } from "@/lib/notifications/publish";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 8 "Achievement Notifications" — real milestones off real, already-
 * accurate counters (profiles.followers_count is trigger-maintained;
 * posts.downloads_count was fixed to actually increment this same round —
 * see [[sw-swx-duplicate-const-bug]]). No AI/prediction — a fixed ladder of
 * round numbers, same as every mainstream app's "100 followers" moment.
 *
 * Deliberately NOT built: Daily Streak / AI Usage Milestone (no streak or
 * AI-usage tracking exists anywhere in this app to hook into) — a real gap,
 * not a silent omission.
 */
const FOLLOWER_MILESTONES = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
const DOWNLOAD_MILESTONES = [100, 1_000, 10_000, 100_000, 1_000_000];

/** Pure — which milestone (if any) did crossing from `before` to `after` just
 * pass? Returns the LARGEST one crossed (never fires more than one at a
 * time, even if a count jumps past several at once — e.g. a bulk import). */
export function milestoneCrossed(before: number, after: number, ladder: number[]): number | null {
  if (after <= before) return null;
  const crossed = ladder.filter((m) => before < m && after >= m);
  return crossed.length > 0 ? Math.max(...crossed) : null;
}

async function celebrate(userId: string, milestoneType: "followers" | "downloads", value: number, push: { title: string; body: string }): Promise<void> {
  try {
    const db = createAdminClient();
    // The unique(user_id, milestone_type, milestone_value) constraint IS the
    // guard against double-celebrating — insert first, only notify if it
    // wasn't already logged (23505 = unique violation, an idempotent no-op,
    // same convention as follow/friend-request duplicate handling elsewhere).
    const { error } = await db.from("milestone_log").insert({ user_id: userId, milestone_type: milestoneType, milestone_value: value });
    if (error) {
      if (error.code !== "23505") return; // a real error — don't notify on an unlogged milestone
      return; // 23505 — already celebrated this one, nothing to do
    }
    await publishNotification({
      userId,
      type: "milestone",
      push: { ...push, url: "/notifications", tag: `milestone:${milestoneType}:${value}` },
    });
  } catch {
    /* best-effort — a missed celebration is not worth failing the caller's own request over */
  }
}

function formatMilestoneNumber(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}K` : String(n);
}

/** Call after a follower count changes upward — checks + celebrates a real crossing, no-ops otherwise. */
export async function checkFollowerMilestone(userId: string, followersBefore: number, followersAfter: number): Promise<void> {
  const crossed = milestoneCrossed(followersBefore, followersAfter, FOLLOWER_MILESTONES);
  if (crossed === null) return;
  const label = formatMilestoneNumber(crossed);
  await celebrate(userId, "followers", crossed, {
    title: "🎉 New milestone!",
    body: `You just hit ${label} followers on Frenz.`,
  });
}

/** Call after a post's download count changes upward. */
export async function checkDownloadMilestone(publisherId: string, downloadsBefore: number, downloadsAfter: number): Promise<void> {
  const crossed = milestoneCrossed(downloadsBefore, downloadsAfter, DOWNLOAD_MILESTONES);
  if (crossed === null) return;
  const label = formatMilestoneNumber(crossed);
  await celebrate(publisherId, "downloads", crossed, {
    title: "🎉 New milestone!",
    body: `One of your posts just passed ${label} downloads.`,
  });
}
