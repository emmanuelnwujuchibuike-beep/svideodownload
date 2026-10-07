import { NextResponse } from "next/server";

import { creditDecisionView, decideCredits, getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { countLiveClones } from "@/lib/ai/voice-clone/clones";
import { publicVoiceCloneConfig, voiceCloneSlotsFor } from "@/lib/ai/voice-clone/config";
import { voiceCloneGate } from "@/lib/ai/voice-clone/create";
import { readFreeClones } from "@/lib/ai/voice-clone/free";
import { publicVoiceCloneQuote, quoteVoiceClone, voiceCloneCredits, voiceCloneMonthKey } from "@/lib/ai/voice-clone/pricing";
import { getAdminUser } from "@/lib/admin/require-admin";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/voice-clones/config — everything the Voice Cloning workspace
 * needs in one read: the sample limits and formats, the consent wording the
 * member must agree to, this month's free voice, their slots, the price of the
 * next clone (there is only one price, so it is quoted here rather than in a
 * second route), and whether the tool is available at all.
 *
 * No provider, no model and no vendor voice id leaves.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-vc-config:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const config = settings.frenzAiVoiceClone;
    const plans = settings.frenzAiPlans;
    const isAdmin = !!adminUser;
    const ownerId = subjectOwnerId(subject);
    const gate = await voiceCloneGate({ settings, entitlement, config }, subject);
    const paused = !gate.ok && (gate.code === "CR_BUSY" || gate.code === "CR_MAINTENANCE");
    const pub = publicVoiceCloneConfig(config, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, { usable: gate.ok, audience: entitlement.audience, isAdmin });
    const monthKey = voiceCloneMonthKey(new Date(), plans.reset.timezone);
    const [free, used] = await Promise.all([readFreeClones(ownerId, monthKey, config.freeClonesPerMonth), countLiveClones(ownerId).catch(() => 0)]);
    const quote = quoteVoiceClone({ freeClonesAvailable: free.remaining }, config, { currency: settings.frenzAiCurrency });
    let credits: ReturnType<typeof creditDecisionView> | null = null;
    if (quote.totalCents > 0 && plans.enabled) {
      const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
      if (creditEntitlement.plan) {
        const estimate = voiceCloneCredits(quote, config, plans);
        credits = creditDecisionView(decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: "voice_clone", durationMs: null, lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans));
      }
    }
    const reason = gate.ok
      ? null
      : typeof gate.extra?.error === "string"
        ? gate.extra.error
        : gate.code === "CR_BUSY"
          ? "Processing is paused for a moment."
          : gate.code === "CR_MAINTENANCE"
            ? "Frenz AI is under maintenance."
            : !config.enabled
              ? "Voice Cloning is not available right now."
              : "Voice Cloning is temporarily unavailable.";
    return NextResponse.json(
      {
        config: pub,
        free: { allowance: free.allowance, used: free.used, remaining: free.remaining, monthKey: free.monthKey },
        quote: { ...publicVoiceCloneQuote(quote), credits: quote.totalCents > 0 ? voiceCloneCredits(quote, config, plans).creditsRequired : 0 },
        unit: "CREDIT",
        credits,
        walletFallback: plans.enabled ? plans.walletFallback : "allow",
        slots: { used, total: voiceCloneSlotsFor(config, { audience: entitlement.audience, isAdmin }) },
        available: gate.ok,
        unavailableReason: paused ? reason : reason,
        audience: isAdmin ? "admin" : entitlement.audience,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[ai/vc/config] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
