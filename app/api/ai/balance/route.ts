import { NextResponse } from "next/server";

import { getAiBalanceCents, listAiLedger } from "@/lib/ai/balance";
import { aiTopupOptions, freeRemaining, isoDate, weekResetsAt, weekStartUtc } from "@/lib/ai/economy";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { peekAiUsage, peekAiWeeklyUsage } from "@/lib/ai/usage";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { resolveAiSubject } from "@/lib/ai/subject-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GET /api/ai/balance — everything the AI dashboard shows, in one request
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §17: "The authenticated AI page should have
 * a premium dashboard at the top. Display: AI Balance… Today's usage… Weekly
 * usage… Current paid price… Usage history."
 *
 * ── 🔴 ONE REQUEST, BECAUSE IT IS ONE PANEL ─────────────────────────────────
 *
 * Balance, both counters, the price and the ledger are five reads that always
 * appear together and are meaningless apart — a balance without the price does
 * not tell anybody how many videos they can make. Five endpoints would mean
 * five round-trips on a phone, five loading states, and five chances for the
 * panel to render half-true.
 *
 * ── 🔴 EVERY NUMBER IS THE SERVER'S ────────────────────────────────────────
 *
 * §21: "Users must not be able to manipulate… client-side counters… balance
 * values… usage counters." Nothing here is computed in the browser and nothing
 * is read back as authority: `/start` re-resolves all of it before it charges,
 * so this response is for DISPLAY only. If it were tampered with, the worst
 * outcome is a wrong number on a screen followed by an honest refusal.
 *
 * ── The remaining count is derived HERE, not in the component ───────────────
 *
 * `freeRemaining` is the min of the two ceilings, and it is the one piece of
 * arithmetic somebody could plausibly get wrong twice. It is computed once, in
 * the same module the reservation uses, and sent as a number.
 */
export async function GET(request: Request) {
  const feat = aiFeature("ai_clean");
  if (!feat) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  const { subject } = await resolveAiSubject(request, feat.id);
  if (!subject) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-balance:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  try {
    const now = new Date();
    const settings = await getLandingSettings();
    const entitlement = await getAiEntitlement(subject, feat);

    const [usage, usedThisWeek, balanceCents, ledger] = await Promise.all([
      peekAiUsage(subject, feat.id),
      peekAiWeeklyUsage(subject, feat.id, isoDate(weekStartUtc(now))),
      /*
        🔴 A balance that cannot be read is NOT zero. Zero would tell a member
        with credit that they have none and send them to pay again, so the whole
        request fails instead and the panel says it could not load.
      */
      getAiBalanceCents(subject.userId ?? ""),
      listAiLedger(subject.userId ?? "", 12),
    ]);

    const dailyLimit = entitlement.dailyLimit;
    const weeklyLimit = settings.frenzAiWeeklyFreeCredits;

    return NextResponse.json({
      balanceCents,
      currency: settings.frenzAiCurrency,
      symbol: aiCurrencySymbol(settings.frenzAiCurrency),
      priceCents: settings.frenzAiVideoPriceCents,
      /* The ladder the top-up screen offers — generated from the operator's
         minimum, and re-validated server-side when one is chosen. */
      topupOptionsCents: aiTopupOptions(settings.frenzAiMinTopupCents),
      usedToday: usage.usedToday,
      dailyLimit,
      usedThisWeek,
      weeklyLimit,
      freeRemaining: freeRemaining({
        usedToday: usage.usedToday,
        usedThisWeek,
        dailyLimit,
        weeklyLimit,
        balanceCents,
      }),
      /* So the panel can say WHEN, rather than "later". */
      weekResetsAt: weekResetsAt(now).toISOString(),
      /*
        🔴 An allow-list of ledger fields — see `listAiLedger`. No Paystack
        reference, no admin id: one is an identifier into a payment provider,
        the other is nobody's business but ours.
      */
      ledger,
    });
  } catch (e) {
    console.error("[ai/balance] read failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
