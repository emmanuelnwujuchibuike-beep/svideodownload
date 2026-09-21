import { NextResponse } from "next/server";

import { getCharacterReplaceFreeEligibility } from "@/lib/ai/character-replace/free-access";
import { affordability } from "@/lib/ai/character-replace/pricing";
import { getCharacterReplaceBalanceCents } from "@/lib/ai/character-replace/wallet";
import { creditDecisionView, decideCredits, getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { estimateSpeechMs, lipSyncCredits, publicLipSyncQuote, quoteLipSync } from "@/lib/ai/lip-sync/pricing";
import { planSpeechPath, resolveLipSyncProRoute, textPathReady } from "@/lib/ai/lip-sync/providers/router";
import { lipSyncQuoteRequestSchema } from "@/lib/ai/lip-sync/schemas";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/lip-sync/quote — the SERVER's price for a Lip Sync Pro
 * generation (§10, §14): the lip-sync line by the kept length, the voice
 * provider's lines only when it will do work, the credits through the one
 * engine with what remains today and this week, the balance, and whether a
 * complimentary creation covers it. Signed; /start recomputes and refuses
 * on any difference. Nothing here moves money.
 */
export async function POST(request: Request) {
  const feature = aiFeature("ai_lip_sync");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-ls-quote:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = lipSyncQuoteRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiLipSync;
    const cr = settings.frenzAiCharacterReplace;
    if (!entitlement.allowed || !config.enabled) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
    const route = resolveLipSyncProRoute(config, settings.frenzAiProviders);
    if (!route.adapter || !route.enabled || !route.configured || route.paused) return NextResponse.json(aiErrorBody("PROVIDER_UNAVAILABLE"), { status: aiErrorStatus("PROVIDER_UNAVAILABLE") });
    const { selectedDurationMs, speechSource } = parsed.data;
    const speechPath = planSpeechPath(speechSource, route.adapter);
    if (speechSource === "text" && !textPathReady(config, route.adapter)) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE", { error: "Typing what they should say isn't available right now." }), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
    const caps = route.adapter.capabilities;
    const minMs = Math.max(config.video.minimumDurationSeconds * 1000, caps.video.minDurationMs ?? 0);
    const maxMs = Math.min(config.video.maximumDurationSeconds * 1000, caps.video.maxDurationMs ?? Infinity);
    if (selectedDurationMs > maxMs) return NextResponse.json(aiErrorBody("CR_ENGINE_LIMIT", { error: `This engine works on clips of up to ${Math.floor(maxMs / 1000)} seconds. Trim your video — nothing has been charged.`, limit: "too_long" }), { status: aiErrorStatus("CR_ENGINE_LIMIT") });
    if (selectedDurationMs < minMs) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: `This engine needs at least ${Math.ceil(minMs / 1000)} seconds of video.`, limit: "too_short" }), { status: aiErrorStatus("INVALID_INPUT") });
    const textCharacters = speechSource === "text" ? (parsed.data.textCharacters ?? 0) : 0;
    if (speechSource === "text" && textCharacters > config.textMode.maximumCharacters) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: `Keep the text to ${config.textMode.maximumCharacters} characters.` }), { status: aiErrorStatus("INVALID_INPUT") });

    const quote = quoteLipSync({ durationMs: selectedDurationMs, speechSource, speechPath, textCharacters }, config, { currency: settings.frenzAiCurrency });
    const balanceCents = await getCharacterReplaceBalanceCents(subject.userId);
    const money = affordability(quote.totalCents, balanceCents);
    const free = await getCharacterReplaceFreeEligibility({ subject, config: cr, request, plans: settings.frenzAiPlans });
    const complimentary = free.eligible && (free.remainingFreeUses === null || free.remainingFreeUses > 0);
    const plans = settings.frenzAiPlans;
    const creditEntitlement = plans.enabled && !complimentary ? await getAiCreditEntitlement(subject.userId, plans) : null;
    const estimate = lipSyncCredits(quote, config, plans);
    const credits = creditEntitlement ? creditDecisionView(decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: estimate.mode, durationMs: quote.durationMs, lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans)) : null;
    const walletOffered = !credits || !credits.applicable || credits.affordable ? true : plans.walletFallback !== "off";
    // §7 / §14: about how long the text will take to say — an estimate, before the speech exists
    const speechEstimateMs = speechSource === "text" ? estimateSpeechMs(textCharacters, parsed.data.speed ?? config.textMode.speed.default) : null;
    const mismatch = speechEstimateMs !== null && Math.abs(speechEstimateMs - selectedDurationMs) / selectedDurationMs > config.duration.significantMismatchFraction ? (speechEstimateMs > selectedDurationMs ? "speech_longer" : "speech_shorter") : null;
    // the member sees the lines and the total, the credits, the complimentary state; never the provider-cost estimate, the vendor or the model
    return NextResponse.json({
      quote: publicLipSyncQuote(quote),
      creditsEstimate: estimate.creditsRequired,
      credits,
      walletFallback: plans.walletFallback,
      walletOffered,
      balanceCents,
      afterCents: complimentary ? balanceCents : money.afterCents,
      sufficient: complimentary ? true : money.sufficient,
      shortfallCents: complimentary ? 0 : money.shortfallCents,
      billing: { complimentary, remaining: free.remainingFreeUses, reason: free.reason },
      speech: { path: speechPath, estimateMs: speechEstimateMs, mismatch, policy: config.duration.policy },
    });
  } catch (e) {
    console.error("[ai/lipsync/quote] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
