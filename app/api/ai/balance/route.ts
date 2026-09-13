import { NextResponse } from "next/server";

import { getAiBalanceCents, listAiLedger } from "@/lib/ai/balance";
import {
  aiTopupCeiling,
  aiTopupFloor,
  aiTopupOptions,
  freeRemaining,
  isoDate,
  weekResetsAt,
  weekStartUtc,
} from "@/lib/ai/economy";
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

  /*
    How much of the statement to send. The dashboard sheet shows five rows
    and asks for the default; the usage page (owner, 2026-09-13: "the usage
    and history button in the AI page should open the usage page") shows the
    whole thing and asks for 100. Clamped here AND in `listAiLedger`, so a
    hand-edited query cannot turn one read into a table scan.
  */
  const ledgerParam = Number(new URL(request.url).searchParams.get("ledger") ?? "");
  const ledgerLimit = Number.isFinite(ledgerParam) && ledgerParam > 0 ? Math.min(100, Math.floor(ledgerParam)) : 12;

  try {
    const now = new Date();
    /*
      ── 🔴 ONE WAVE, NOT THREE (owner, 2026-09-13: "the dashboard should load
      more faster") ─────────────────────────────────────────────────────────

      This was `await settings`, then `await entitlement`, then the four reads
      in parallel — three round-trips end to end for six reads that do not
      depend on each other. The entitlement needs the settings, and reads them
      itself through the same TTL cache, so asking for both at once costs one
      settings read either way. Everything now leaves together.
    */
    const [settings, entitlement, usage, usedThisWeek, balanceCents, ledger] = await Promise.all([
      getLandingSettings(),
      getAiEntitlement(subject, feat),
      peekAiUsage(subject, feat.id),
      peekAiWeeklyUsage(subject, feat.id, isoDate(weekStartUtc(now))),
      /*
        🔴 A balance that cannot be read is NOT zero. Zero would tell a member
        with credit that they have none and send them to pay again, so the whole
        request fails instead and the panel says it could not load.
      */
      getAiBalanceCents(subject.userId ?? ""),
      listAiLedger(subject.userId ?? "", ledgerLimit),
    ]);

    const dailyLimit = entitlement.dailyLimit;
    const weeklyLimit = settings.frenzAiWeeklyFreeCredits;
    /*
      ── 🔴 A COUNTER NEVER DISPLAYS ABOVE ITS LIMIT (owner, 2026-09-13) ────

      "Some account shows more weekly free than the one allowed" — a
      screenshot reading "THIS WEEK 16 / 5 free".

      The weekly figure sums `reserved_jobs` over the week's rows. Until
      2026-09-09 (ee2add0) EVERY job reserved a slot and there was no weekly
      ceiling, so an account that ran sixteen jobs earlier this week carries
      them into a five-a-week world; the ceiling itself is also a soft,
      non-atomic brake (lib/ai/funding.ts), and an operator can lower either
      limit mid-period. The GATE has always been right — `freeRemaining`
      floors at zero — but the display repeated the raw sum.

      An allowance that is spent reads as spent: "5 / 5". The raw figures
      still feed `freeRemaining` below, unchanged.
    */
    const usedTodayShown = Math.min(usage.usedToday, dailyLimit);
    const usedThisWeekShown = Math.min(usedThisWeek, weeklyLimit);

    return NextResponse.json({
      balanceCents,
      currency: settings.frenzAiCurrency,
      symbol: aiCurrencySymbol(settings.frenzAiCurrency),
      priceCents: settings.frenzAiVideoPriceCents,
      /* The ladder the top-up screen offers — generated from the operator's
         minimum, and re-validated server-side when one is chosen. */
      topupOptionsCents: aiTopupOptions(settings.frenzAiMinTopupCents),
      /*
        🔴 THE BOUNDS ON A CUSTOM AMOUNT (owner, 2026-09-09: "the add balance
        dont have an input field to add a custom amount").

        Sent so the field can say what it will accept BEFORE somebody types an
        amount and presses a button that fails. They are a courtesy, exactly
        like `canStart` on the entitlement — `/topup` re-reads both from the
        operator's settings and refuses anything outside them, so editing these
        in a browser changes nothing except the message shown locally.
      */
      minTopupCents: aiTopupFloor(settings.frenzAiMinTopupCents),
      maxTopupCents: aiTopupCeiling(settings.frenzAiMinTopupCents),
      usedToday: usedTodayShown,
      dailyLimit,
      usedThisWeek: usedThisWeekShown,
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
