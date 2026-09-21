import { NextResponse } from "next/server";

import { voiceProviderForModel } from "@/lib/ai/character-replace/config";
import { deviceCookieHeader, newDeviceId, readDeviceId } from "@/lib/ai/character-replace/free-access";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { planSpeechPath, publicLipSyncConfig, resolveLipSyncProRoute } from "@/lib/ai/lip-sync/providers/router";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { ttsSupportedLanguagesFor } from "@/lib/ai/voice/tts-languages";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { hasWorker } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/lip-sync/config — what the Lip Sync Pro workspace may offer THIS
 * member: the tool's ceilings, the ACTIVE model's capability flags (§12), the
 * voices and languages for typed text — the native model's own voices when
 * it speaks the text itself, the voice provider's catalogue otherwise — and
 * whether processing is available. No vendor or model name leaves.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_lip_sync");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject) return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-ls-config:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const cr = settings.frenzAiCharacterReplace;
    const ls = settings.frenzAiLipSync;
    const launched = await launchAllows(cr, subject);
    const config = publicLipSyncConfig(ls, settings.frenzAiProviders, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) });
    const route = resolveLipSyncProRoute(ls, settings.frenzAiProviders);
    const path = planSpeechPath("text", route.adapter);
    // the voices and languages the text path can honour
    let voices: { id: string; label: string; blurb: string; languages: readonly string[]; gender: string; age?: string }[] = [];
    let languages: { code: string; label: string; native: string }[] = [];
    if (path === "native" && route.adapter?.nativeVoices) {
      voices = route.adapter.nativeVoices.filter((v) => !ls.voiceIds.length || ls.voiceIds.includes(v.id)).map((v) => ({ id: v.id, label: v.label, blurb: v.language === "zh" ? "Chinese" : "English", languages: [v.language], gender: v.gender }));
      const codes = [...new Set(route.adapter.nativeVoices.map((v) => v.language))].filter((c) => !ls.languageCodes.length || ls.languageCodes.includes(c));
      languages = codes.map((code) => cr.languages.find((l) => l.code === code) ?? { code, label: code === "zh" ? "Chinese" : code === "en" ? "English" : code, native: code === "zh" ? "中文" : code === "en" ? "English" : code });
    } else {
      const provider = voiceProviderForModel(ls.tts.model);
      const spoken = new Set(ttsSupportedLanguagesFor(ls.tts.model));
      voices = cr.voices.filter((v) => v.provider === provider && (!ls.voiceIds.length || ls.voiceIds.includes(v.id))).map((v) => ({ id: v.id, label: v.label, blurb: v.blurb, languages: v.languages, gender: v.gender, age: v.age }));
      languages = cr.languages.filter((l) => spoken.has(l.code) && (!ls.languageCodes.length || ls.languageCodes.includes(l.code)));
    }
    const headers = new Headers();
    if (!readDeviceId(request)) headers.append("set-cookie", deviceCookieHeader(newDeviceId()));
    return NextResponse.json(
      {
        config: { ...config, voices, languages },
        available: config.enabled && entitlement.allowed && launched,
        unavailableReason: config.enabled && entitlement.allowed && !launched ? LAUNCH_INTERNAL_MESSAGE : !config.enabled ? "Lip Sync Pro isn't available right now." : null,
        processingAvailable: config.enabled && hasWorker && cr.ops.processingEnabled && !cr.ops.maintenanceMode,
        processingUnavailableReason: cr.ops.maintenanceMode ? cr.ops.maintenanceMessage : !cr.ops.processingEnabled ? "Processing is paused for a moment." : null,
        audience: entitlement.audience,
      },
      { headers },
    );
  } catch (e) {
    console.error("[ai/lipsync/config] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
