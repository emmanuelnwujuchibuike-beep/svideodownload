/**
 * Creator Journey™ (Feature 15 · Part 9) — the inspiring timeline, built only
 * from milestones this platform can PROVE happened, on the date it can prove
 * they happened.
 *
 * ── Why it is not lib/social/life-journey.ts ─────────────────────────────
 * That is the MEMBER's story — joined, first post, friends made, reputation
 * rank — and half its entries are current-state highlights with no date at all
 * ("42 posts shared"). This is the CREATOR's ladder: every rung is an event
 * with a moment, ordered, and the ones not yet reached are shown as locked
 * steps with the real distance remaining. Two different shapes; sharing one
 * module would have meant one of them lying about the other's data.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 * A reached milestone MUST carry the date of the row that proves it. Where the
 * platform knows a threshold was crossed but not when (counters are
 * denormalized totals — `followers_count` does not remember the day it passed
 * 100), the milestone is reported as reached WITHOUT a date rather than with a
 * plausible one. An invented date on an "inspiring journey" is still an
 * invented date.
 *
 * "First viral video" is the creator's own best-performing post, named as
 * exactly that. There is no global virality threshold in this product — no
 * distribution is computed anywhere — so "went viral" would be a claim nothing
 * backs. Their best post is real, dated, and means something to them.
 *
 * Pure: no React, no Supabase, no clock beyond what is passed in.
 */

export interface JourneySignals {
  /** Account creation — always known. */
  joinedAt: string;
  /** The creator's first published post, if any. */
  firstPost: { id: string; title: string; createdAt: string; thumbnailUrl: string | null } | null;
  /** Their best-performing post by views, if any. */
  topPost: { id: string; title: string; views: number; createdAt: string; thumbnailUrl: string | null } | null;
  /** Lifetime totals, as denormalized counters. */
  totalViews: number;
  followers: number;
  totalPosts: number;
  /** When the first follow row was created — a real, dated event. */
  firstFollowerAt: string | null;
  /** Whether they are verified. `profiles.is_verified` is the authority. */
  isVerified: boolean;
  /**
   * When verification was granted — `verification_requests.reviewed_at`
   * (migration 0104). Null for a creator verified before that table existed, or
   * by an admin acting on the profile row directly: they ARE verified and the
   * milestone is reached, it simply has no date to show. Reached and dated are
   * separate facts here, exactly as they are for the view milestones.
   */
  verifiedAt: string | null;
  /** Sounds this creator has published (Part 7), and the first one's date. */
  soundsPublished: number;
  firstSoundAt: string | null;
}

export interface JourneyStep {
  key: string;
  title: string;
  /** Only present when the platform can prove WHEN. */
  date?: string;
  /** What was reached, or what remains. */
  detail: string;
  reached: boolean;
  /** 0-1 toward the next rung, for the locked steps. */
  progress: number;
  iconKey: "rocket" | "eye" | "users" | "flame" | "music" | "badge" | "crown" | "trophy";
  tint: "violet" | "blue" | "cyan" | "emerald" | "amber" | "rose";
  thumbnailUrl?: string | null;
}

/** The follower ladder, matching lib/social/milestones.ts so the journey and
 *  the celebration push can never disagree about what counts as a milestone. */
const FOLLOWER_LADDER = [1, 100, 1_000, 10_000, 100_000, 1_000_000];
const VIEW_LADDER = [100, 1_000, 100_000, 1_000_000];

function fmt(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}K` : String(n);
}

export function buildCreatorJourney(s: JourneySignals): JourneyStep[] {
  const steps: JourneyStep[] = [
    {
      key: "joined",
      title: "Joined Frenzsave",
      date: s.joinedAt,
      detail: "Where it started.",
      reached: true,
      progress: 1,
      iconKey: "rocket",
      tint: "violet",
    },
  ];

  steps.push(
    s.firstPost
      ? {
          key: "first-upload",
          title: "First upload",
          date: s.firstPost.createdAt,
          detail: s.firstPost.title,
          reached: true,
          progress: 1,
          iconKey: "rocket",
          tint: "blue",
          thumbnailUrl: s.firstPost.thumbnailUrl,
        }
      : {
          key: "first-upload",
          title: "First upload",
          detail: "Publish something to begin.",
          reached: false,
          progress: 0,
          iconKey: "rocket",
          tint: "blue",
        },
  );

  // View milestones. Reached ones carry no date: `views_count` is a running
  // counter that does not remember the day it crossed a number, and there is no
  // per-day view series per post to recover it from.
  for (const target of VIEW_LADDER) {
    const reached = s.totalViews >= target;
    steps.push({
      key: `views-${target}`,
      title: `First ${fmt(target)} views`,
      detail: reached
        ? `${s.totalViews.toLocaleString()} views so far.`
        : `${(target - s.totalViews).toLocaleString()} to go.`,
      reached,
      progress: Math.max(0, Math.min(1, s.totalViews / target)),
      iconKey: "eye",
      tint: "cyan",
    });
  }

  // The first follower IS dated — `follows.created_at` is a real row.
  steps.push({
    key: "first-follower",
    title: "First follower",
    date: s.firstFollowerAt ?? undefined,
    detail: s.firstFollowerAt ? "Someone chose to keep watching." : "Nobody yet — it starts with one.",
    reached: s.firstFollowerAt !== null || s.followers > 0,
    progress: s.followers > 0 ? 1 : 0,
    iconKey: "users",
    tint: "emerald",
  });

  if (s.topPost) {
    steps.push({
      key: "best-post",
      title: "Your best post so far",
      date: s.topPost.createdAt,
      detail: `${s.topPost.title} — ${s.topPost.views.toLocaleString()} views.`,
      reached: true,
      progress: 1,
      iconKey: "flame",
      tint: "rose",
      thumbnailUrl: s.topPost.thumbnailUrl,
    });
  }

  if (s.soundsPublished > 0) {
    steps.push({
      key: "first-sound",
      title: "First sound published",
      date: s.firstSoundAt ?? undefined,
      detail: `${s.soundsPublished} ${s.soundsPublished === 1 ? "sound" : "sounds"} others can use.`,
      reached: true,
      progress: 1,
      iconKey: "music",
      tint: "violet",
    });
  }

  for (const target of FOLLOWER_LADDER.slice(1)) {
    const reached = s.followers >= target;
    steps.push({
      key: `followers-${target}`,
      title: `${fmt(target)} followers`,
      detail: reached
        ? `${s.followers.toLocaleString()} following your work.`
        : `${(target - s.followers).toLocaleString()} to go.`,
      reached,
      progress: Math.max(0, Math.min(1, s.followers / target)),
      iconKey: target >= 1_000_000 ? "crown" : "users",
      tint: "amber",
    });
  }

  const verified = s.isVerified || s.verifiedAt !== null;
  steps.push({
    key: "verified",
    title: "Verified creator",
    date: s.verifiedAt ?? undefined,
    detail: verified ? "Your identity is confirmed." : "Apply once your profile is established.",
    reached: verified,
    progress: verified ? 1 : 0,
    iconKey: "badge",
    tint: "blue",
  });

  return steps;
}

/** The next rung worth aiming at — the first unreached step, or null when the
 *  ladder is finished. Drives the Creator Home "next milestone" card. */
export function nextMilestone(steps: JourneyStep[]): JourneyStep | null {
  return steps.find((s) => !s.reached) ?? null;
}
