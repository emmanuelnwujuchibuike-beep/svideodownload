import type { AiAudience } from "@/lib/ai/audience";

/**
 * Frenz AI's daily allowance, in CREDITS.
 *
 * ⚠️ REVISED 2026-09-08. The note here used to read "Frenz AI is for signed-in
 * members only, so there is no guest tier at all". That stopped being true when
 * the owner opened AI Clean to anonymous visitors — but only AI Clean.
 *
 * The distinction survives and is now the interesting part: a guest has a real
 * allowance for the VIDEO TEXT REMOVER, which is metered per feature in
 * Postgres and paid for by a rewarded ad, and NO credits at all for the tools
 * this file governs. Those spend the owner's Anthropic key per request with
 * nothing offsetting them, which is a different economic question and gets a
 * different answer.
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
export const FRENZ_AI_DAILY_CREDITS: Record<AiAudience, number> = {
  /*
    🔴 A GUEST SPENDS NO CREDITS. Anonymous access is AI Clean only, which has
    its own per-feature allowance and a rewarded ad to offset it. The credit
    pool funds the vision tools, which bill the owner's Anthropic key per
    request with nothing to offset them at all.
  */
  guest: 0,
  free: 12,
  pro: 80,
  business: 300,
  /*
    ⚠️ 15, AND IT IS NOT THE VIDEO TEXT REMOVER LIMIT.

    Owner, 2026-09-08: "Max AI's existing 15 AI credits/day must remain
    separate… the two systems must not accidentally increase or decrease one
    another", and most sharply: "The existing 15 AI credits must NEVER allow Max
    AI to exceed 30 Video Text Remover generations per day."

    These credits are a Redis counter keyed `ai:u:<id>`, spent by
    /api/ai/media. Video Text Remover's 30/day is a Postgres row in
    `ai_usage_daily` keyed by feature. Neither is computed from the other, and
    policy.test.ts pins that they stay different numbers in different systems —
    because "they happen not to be connected" is a property that decays the
    moment somebody tidies one into the other.
  */
  max_ai: 15,
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

export function frenzAiDailyCredits(plan: AiAudience): number {
  return FRENZ_AI_DAILY_CREDITS[plan] ?? FRENZ_AI_DAILY_CREDITS.free;
}

/**
 * The counter key. Per MEMBER: the credit pool has no anonymous tier, so this
 * is never called for a guest — see the revised note at the top of this file.
 */
export function frenzAiQuotaKey(userId: string): string {
  return `ai:u:${userId}`;
}
