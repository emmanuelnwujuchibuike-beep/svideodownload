/**
 * Share anti-spam (Feature 15 · Part 6 tranche 2) — same three-verdict shape
 * as `lib/social/repost/antispam.ts`, adapted for what a plain share actually
 * IS: a direct message to people the sharer explicitly chose, not a public
 * distribution. That difference matters for what `throttle` means here.
 *
 * ── Why `throttle` doesn't mean the same thing as repost's ────────────────
 * Repost's `throttle` writes the row but excludes it from the (public)
 * distribution engine — the repost still exists, nobody sees it surfaced.
 * A share has no downstream distribution step to exclude it from: the
 * message either reaches the specifically chosen recipient or it doesn't,
 * and refusing to deliver a DM to someone the sharer picked punishes the
 * RECIPIENT, not just the sharer, for behaviour that's entirely the
 * sharer's. So here `throttle` still sends the message, and only
 * suppresses the two things that make repeated sharing SELF-REINFORCING —
 * the `posts.shares_count` bump and the "your post was shared" notification
 * to the original author — rather than the delivery itself.
 *
 * `block` is reserved for rates no human hand produces, same as repost.
 *
 * Pure: no React, no Supabase, no I/O. The caller fetches a bounded window
 * of `share_events` and passes it in.
 */

export interface ShareHistoryEntry {
  postId: string;
  creatorId: string;
  /** Epoch ms. */
  createdAt: number;
  recipientCount: number;
}

export interface ShareAntiSpamInput {
  /** This sharer's own recent share_events rows, any order. */
  recent: readonly ShareHistoryEntry[];
  /** The creator of the post being shared right now. */
  targetCreatorId: string;
  now: number;
}

export type ShareSpamVerdict = "allow" | "throttle" | "block";

export interface ShareAntiSpamResult {
  verdict: ShareSpamVerdict;
  /** Plain-language reasons, safe to show the sharer. */
  reasons: string[];
  /** Only set on `block`. */
  retryAfterMs?: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const SHARE_LIMITS = {
  /** No human hand fires ten separate share actions in five minutes. */
  burstWindowMs: 5 * MIN,
  burstMax: 10,
  /** Generous — a very active day, not a script. Each action can already
   *  carry up to 10 recipients, so this bounds ACTIONS, not raw messages. */
  dailyMax: 60,
  /** Of the last ten share actions, how many from one creator before it
   *  reads as promoting that creator rather than recommending posts. */
  creatorShareWindow: 10,
  creatorShareMax: 7,
} as const;

export function checkShareSpam(input: ShareAntiSpamInput): ShareAntiSpamResult {
  const reasons: string[] = [];
  let verdict: ShareSpamVerdict = "allow";
  let retryAfterMs: number | undefined;

  const inWindow = (ms: number) => input.recent.filter((r) => input.now - r.createdAt < ms);

  const burst = inWindow(SHARE_LIMITS.burstWindowMs);
  if (burst.length >= SHARE_LIMITS.burstMax) {
    verdict = "block";
    reasons.push("You're sharing very quickly. Take a moment.");
    const oldest = Math.min(...burst.map((r) => r.createdAt));
    retryAfterMs = Math.max(1000, SHARE_LIMITS.burstWindowMs - (input.now - oldest));
  }

  const daily = inWindow(24 * HOUR);
  if (daily.length >= SHARE_LIMITS.dailyMax) {
    verdict = "block";
    reasons.push("You've reached today's sharing limit.");
    const oldest = Math.min(...daily.map((r) => r.createdAt));
    retryAfterMs = Math.max(retryAfterMs ?? 0, 24 * HOUR - (input.now - oldest));
  }

  // ── Throttle: delivered, but doesn't count or notify ─────────────────────
  if (verdict !== "block") {
    const lastTen = [...input.recent].sort((a, b) => b.createdAt - a.createdAt).slice(0, SHARE_LIMITS.creatorShareWindow);
    const sameCreator = lastTen.filter((r) => r.creatorId === input.targetCreatorId).length;
    if (lastTen.length >= SHARE_LIMITS.creatorShareWindow && sameCreator + 1 > SHARE_LIMITS.creatorShareMax) {
      verdict = "throttle";
      reasons.push("Most of your recent shares are from one creator.");
    }
  }

  return { verdict, reasons, ...(retryAfterMs != null ? { retryAfterMs: Math.round(retryAfterMs) } : {}) };
}
