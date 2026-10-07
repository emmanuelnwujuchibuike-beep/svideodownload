import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { featureContext } from "@/lib/ai/credits/feature-gate";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { publicTextToAudioConfig, textToAudioAllowance } from "@/lib/ai/text-to-audio/config";
import { readFreeCharacters } from "@/lib/ai/text-to-audio/free";
import { modelCharacterCeiling, textToAudioGate } from "@/lib/ai/text-to-audio/generate";
import { textToAudioMonthKey } from "@/lib/ai/text-to-audio/pricing";
import { routeAllowsClones, textToAudioVoices } from "@/lib/ai/text-to-audio/route";
import { usableCloneOptions } from "@/lib/ai/voice-clone/usable";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/text-to-audio/config — what the Text to Audio workspace may
 * offer THIS member: the ceilings, the price line, the voices and languages
 * the active route can speak, this month's free characters (allowance, used,
 * remaining), and whether the tool is available. No route, vendor or model
 * name leaves.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject) return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-tta-config:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiTextToAudio;
    const gate = await textToAudioGate({ settings, entitlement }, subject);
    const paused = gate.code === "CR_BUSY" || gate.code === "CR_MAINTENANCE";
    const pub = publicTextToAudioConfig(config, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, gate.resolved.enabled && gate.resolved.configured && entitlement.allowed, settings.frenzAiPlans.credits.centsPerCredit);
    const { voices, languages } = textToAudioVoices(config, settings.frenzAiCharacterReplace, gate.resolved);
    /*
      2026-09-27: the member's own cloned voices, FIRST in the list — they made
      them, they are looking for them. Only on the direct route, which is the
      only one that can speak one (lib/ai/voice-clone/usable.ts).
    */
    const monthKey = textToAudioMonthKey(new Date(), settings.frenzAiPlans.reset.timezone);
    /*
      2026-10-07 (owner: "buttons respond slow"): the member's own voices and
      the month's characters for their tier leave together — they were three
      round trips in a row on every Text to Audio page open.
    */
    const ownerId = subject.kind === "user" ? subjectOwnerId(subject) : null;
    const [own, { tier, free }] = await Promise.all([
      ownerId ? usableCloneOptions(ownerId, { allowed: routeAllowsClones(gate.resolved.route) && settings.frenzAiVoiceClone.enabled }) : Promise.resolve([]),
      (async () => {
        // 0185: the month's characters for THIS member's tier (Free / AI Pro / AI Max)
        const t = ownerId ? (await featureContext(ownerId, "ai_text_to_audio", settings.frenzAiPlans)).tier : "free";
        const f = ownerId ? await readFreeCharacters(ownerId, monthKey, textToAudioAllowance(config, t)) : { allowance: 0, used: 0, remaining: 0, monthKey };
        return { tier: t, free: f };
      })(),
    ]);
    const reason = gate.ok ? null : typeof gate.extra?.error === "string" ? gate.extra.error : gate.code === "CR_BUSY" ? "Processing is paused for a moment." : gate.code === "CR_MAINTENANCE" ? "Frenz AI is under maintenance." : !config.enabled ? "Text to Audio is not available right now." : "Text to Audio is temporarily unavailable.";
    return NextResponse.json({
      config: { ...pub, maximumCharacters: Math.min(pub.maximumCharacters, modelCharacterCeiling(gate.resolved.model)), voices: [...own, ...voices], languages },
      free: { allowance: free.allowance, used: free.used, remaining: free.remaining, monthKey: free.monthKey, tier, partialAllowance: config.partialAllowance },
      available: gate.ok,
      unavailableReason: reason,
      processingAvailable: (gate.ok || paused) && gate.resolved.enabled && gate.resolved.configured && !paused,
      audience: entitlement.audience,
      currency: settings.frenzAiCurrency,
    });
  } catch (e) {
    console.error("[ai/tta/config] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
