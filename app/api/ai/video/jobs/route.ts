import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId } from "@/lib/ai/jobs";
import { klingPipeline } from "@/lib/ai/kling/pipelines/registry";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { createKlingVideoJob, publicKlingQuote } from "@/lib/ai/video/create";
import { createVideoJobSchema } from "@/lib/ai/video/schemas";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Long enough to price, reserve, write the row and hand the request to Kling —
 * and no longer. §33: the browser NEVER waits for a generation. This returns
 * the moment Kling has accepted the work; the outcome arrives at
 * /api/webhooks/kling and the member is notified even with the app closed.
 */
export const maxDuration = 60;

const fail = (code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) => NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });

/**
 * POST /api/ai/video/jobs — Generate.
 *
 * One route for the three Kling video tools, and that is INFRASTRUCTURE, not a
 * shared pipeline (Part 5 §2): auth, rate limiting, idempotency and the money
 * sequence are identical for all three, while every per-feature decision —
 * validation, the request body, the endpoint, what is billable — is the
 * pipeline's. There is no `switch (feature)` here; the registry resolves one.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createVideoJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  if (!isValidClientRequestId(parsed.data.clientRequestId)) return fail("INVALID_INPUT");

  const pipeline = klingPipeline(parsed.data.feature);
  const feature = aiFeature(pipeline.aiFeature);
  if (!feature) return fail("FEATURE_UNAVAILABLE");

  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-video-job:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL).replace(/\/$/, "");
    const outcome = await createKlingVideoJob({
      feature: parsed.data.feature,
      input: parsed.data.input as never,
      subject,
      clientRequestId: parsed.data.clientRequestId,
      shownTotalCents: parsed.data.shownTotalCents ?? null,
      preferWallet: parsed.data.funding === "wallet",
      settings,
      entitlement,
      isAdmin: !!adminUser,
      callbackUrl: `${origin}/api/webhooks/kling`,
    });
    if (!outcome.ok) return fail(outcome.code as Parameters<typeof aiErrorBody>[0], outcome.extra);
    return NextResponse.json({ jobId: outcome.jobId, quote: publicKlingQuote(outcome.quote), funding: outcome.funding, balanceCents: outcome.balanceCents, credits: outcome.credits }, { status: 201 });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/video/jobs] failed", { subject: subject.key, feature: parsed.data.feature, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/video/jobs] threw", { subject: subject.key, feature: parsed.data.feature, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
