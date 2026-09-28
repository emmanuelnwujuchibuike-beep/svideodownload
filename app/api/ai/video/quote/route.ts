import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { klingConfigured } from "@/lib/ai/kling/client";
import { klingCapability, klingPipeline } from "@/lib/ai/kling/pipelines/registry";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { publicKlingQuote } from "@/lib/ai/video/create";
import { videoQuoteRequestSchema } from "@/lib/ai/video/schemas";
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
  const quote = pipeline.quote(parsed.data.input as never, settings.frenzAiKlingPricing);
  if (!quote.ok) return NextResponse.json({ ok: false, reason: quote.reason }, { status: 200 });
  return NextResponse.json({ ok: true, quote: publicKlingQuote(quote), currency: settings.frenzAiCurrency }, { status: 200 });
}
