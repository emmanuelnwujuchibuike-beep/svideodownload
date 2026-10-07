import { NextResponse } from "next/server";

import { deviceCookieHeader, getCharacterReplaceFreeEligibility, newDeviceId, readDeviceId } from "@/lib/ai/character-replace/free-access";
import { featureContext } from "@/lib/ai/credits/feature-gate";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { klingConfigured } from "@/lib/ai/kling/client";
import { klingCapability, klingPipeline } from "@/lib/ai/kling/pipelines/registry";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { publicKlingQuote, videoCredits } from "@/lib/ai/video/create";
import { FREE_VIDEO_SUMMARY, freeVideoQualifies, type FreeVideoRequest } from "@/lib/ai/video/free-video";
import { videoQuoteRequestSchema } from "@/lib/ai/video/schemas";
import { getAdminUser } from "@/lib/admin/guard";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/video/quote — what THIS request would cost, decided by the
 * server (Part 5 §26, Part 6 §55).
 *
 * 🔴 The browser never computes a price. It sends the settings a member chose
 * and renders the number that comes back; `/jobs` recomputes and refuses a
 * difference with PRICE_CHANGED. Nothing is reserved here.
 *
 * The response carries only what a member may see — no provider units, no
 * provider cost, no margin (`publicKlingQuote`).
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = videoQuoteRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });

  const pipeline = klingPipeline(parsed.data.feature);
  const feature = aiFeature(pipeline.aiFeature);
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });

  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-video-quote:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  const [settings] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
  const capability = klingCapability(parsed.data.feature, { configured: klingConfigured(), pricing: settings.frenzAiKlingPricing });
  if (capability.state !== "available") {
    return NextResponse.json({ ok: false, capability: { state: capability.state, reason: capability.reason } }, { status: 200 });
  }

  // The pipeline decides which dimensions of ITS request are billable.
  /*
    🔴 The device marker the complimentary video's once-per-device rule counts
    (owner, 2026-10-07). Planted here because every creation is quoted first;
    the create route refuses a complimentary video without it.
  */
  const headers = new Headers();
  const deviceId = readDeviceId(request);
  if (!deviceId) headers.append("set-cookie", deviceCookieHeader(newDeviceId()));

  const quote = pipeline.quote(parsed.data.input as never, settings.frenzAiKlingPricing);
  if (!quote.ok) return NextResponse.json({ ok: false, reason: quote.reason }, { status: 200, headers });

  /*
    Would THIS request be the complimentary video? Asked only when it fits the
    rules (3 s · 720p · no reference video), so changing other options never
    touches the allowance read. Display only — /jobs decides again.
  */
  /*
    Owner, 2026-10-07: "make users who want to use free video generation be
    informed that free only supports 720p, 3 seconds and no reference video
    or native audio". So the page is told whether the member HAS a free video
    left at all (`available`), whether THESE settings would use it
    (`eligible`), and if not, which setting is in the way (`blockedBy`).
    Display only — /jobs decides again with the same rule.
  */
  const verdict = freeVideoQualifies(parsed.data.input as unknown as FreeVideoRequest);
  const oneMinute = (parsed.data.input as { options?: { durationSeconds?: unknown } }).options?.durationSeconds === 60;
  let complimentary: { eligible: boolean; available: boolean; rules: string; blockedBy: string | null } = { eligible: false, available: false, rules: FREE_VIDEO_SUMMARY, blockedBy: null };
  const cr = settings.frenzAiCharacterReplace;
  // 2026-10-07: the admin check and the member's feature rules leave together (they were two more round trips in a row on every option change)
  const [adminUser, fctx] = await Promise.all([getAdminUser().catch(() => null), featureContext(subject.userId, feature.id, settings.frenzAiPlans)]);
  const isAdmin = !!adminUser;
  if (deviceId || isAdmin || !cr.antiAbuse.deviceDetection) {
    const e = await getCharacterReplaceFreeEligibility({ subject, config: cr, request, isAdmin, plans: settings.frenzAiPlans }).catch(() => null);
    const available = !!e?.eligible && (e.remainingFreeUses === null || e.remainingFreeUses > 0);
    const fits = verdict.ok && !oneMinute;
    complimentary = { eligible: available && fits, available, rules: FREE_VIDEO_SUMMARY, blockedBy: available && !fits ? (verdict.ok ? "The complimentary video is 3 seconds long." : verdict.message) : null };
  }
  const credits = videoCredits(quote, feature.id, pipeline.label, settings.frenzAiPlans).creditsRequired;
  // 0185: the member's rules for this feature — tier, included generations left, pay-as-you-go (display; /jobs decides again)
  const access = fctx.view;
  return NextResponse.json({ ok: true, quote: publicKlingQuote(quote, credits), currency: settings.frenzAiCurrency, complimentary, access }, { status: 200, headers });
}
