import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Frenz AI's daily allowance, in CREDITS.
 *
 * Owner, 2026-09-07: Frenz AI is for signed-in members only. So there is no
 * guest tier here at all — an anonymous visitor is refused before a limit is
 * ever looked up, which is a different thing from having a limit of zero and
 * reads differently in the UI.
 *
 * ── Credits, not runs ─────────────────────────────────────────────────────────
 *
 * Each tool declares a cost (lib/ai/tools.ts) because they are not equal:
 * reading four stills off a clip is several times the work of rewriting a
 * caption. A flat "20 uses a day" would let the expensive tool hide inside the
 * cheap one in every usage number and in the bill.
 *
 * ── Why these numbers ─────────────────────────────────────────────────────────
 *
 * 🔴 Every request spends the OWNER'S Anthropic key, and vision requests are
 * the expensive kind. The free tier is set so a member can genuinely try the
 * feature — several summaries a day — without one enthusiastic signed-in user
 * being able to run up a bill on their own. It is deliberately easy to raise
 * later and painful to lower, so it starts conservative.
 *
 * Kept as a plain table rather than folded into `PlanLimits`: that interface is
 * read by the download path and mirrored into admin overrides, and Frenz AI
 * should not be able to break either while its shape is still settling.
 */
export const FRENZ_AI_DAILY_CREDITS: Record<BillingPlan, number> = {
  free: 12,
  pro: 80,
  business: 300,
};

/*
  ── A WEEKLY BUCKET IS COMING, AND THIS IS WHERE IT GOES ────────────────────

  Owner, 2026-09-07: "the daily quoata will be charged by credits per day and
  week, it will be directed in next session."

  The numbers are not invented here. What this slice commits to is the SHAPE
  they will slot into, so the next session sets values rather than restructures:

    - the allowance is already CREDITS, not runs, so a weekly figure is the same
      unit and the two can be compared and displayed together;
    - `consumeDailyUnits` (lib/rate-limit.ts) is keyed and TTL'd per bucket, so a
      weekly sibling is the same function with a different key and expiry rather
      than a second counting system;
    - the route charges ONCE and returns `{ used, limit }`, so adding a second
      dimension means both being charged and both being returned — not a new
      call site.

  🔴 A member must have to pass BOTH when it lands. A weekly cap that a daily
  cap can exhaust in a day is not a cap, and a daily cap that resets a weekly
  one is not either.
*/

export function frenzAiDailyCredits(plan: BillingPlan): number {
  return FRENZ_AI_DAILY_CREDITS[plan] ?? FRENZ_AI_DAILY_CREDITS.free;
}

/** The counter key. Per MEMBER — Frenz AI has no anonymous tier to key by IP. */
export function frenzAiQuotaKey(userId: string): string {
  return `ai:u:${userId}`;
}
