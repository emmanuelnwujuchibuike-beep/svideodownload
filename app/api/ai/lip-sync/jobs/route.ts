import { NextResponse } from "next/server";

import { concurrencyLimitFor } from "@/lib/ai/character-replace/config";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { findJobByRequestId, getOwnJob } from "@/lib/ai/job-store";
import { countOpenLipSyncJobs, openLipSyncGate, openLipSyncJob, screenLipSyncFacts, validateLipSyncFacts } from "@/lib/ai/lip-sync/open-job";
import { createLipSyncJobSchema } from "@/lib/ai/lip-sync/schemas";
import { supersedeOwnDrafts } from "@/lib/ai/retention";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/lip-sync/jobs — open a Lip Sync Pro job, mint the upload tickets
 * (the video; the audio file when that is the speech source). Nothing is
 * charged and nothing is sent anywhere. Idempotent on `clientRequestId`. The
 * body carries EXACTLY ONE speech source — the schema is a discriminated
 * union, so "both" and "neither" do not parse (§3).
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_lip_sync");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-ls-job:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createLipSyncJobSchema.safeParse(raw);
  if (!parsed.success) {
    // §3, in the member's words: a body naming both or neither speech source is the usual cause
    const speech = (raw as { speech?: unknown } | null)?.speech;
    const both = !!speech && typeof speech === "object" && "text" in (speech as object) && "audio" in (speech as object);
    return fail("INVALID_INPUT", { error: both ? "Choose one: type what they should say, or upload an audio file — not both." : !speech ? "Choose a speech source: type text, or upload an audio file." : undefined });
  }
  const { clientRequestId, retryOf, ...facts } = parsed.data;
  if (!isValidClientRequestId(clientRequestId)) return fail("INVALID_INPUT");

  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const config = settings.frenzAiLipSync;
    const gate = await openLipSyncGate({ subject, feature, settings, entitlement, config }, facts.speech.source);
    if (!gate.ok) return fail(gate.code, gate.extra);
    const ctx = { subject, feature, settings, entitlement, config, publicConfig: gate.publicConfig };
    const invalid = validateLipSyncFacts(ctx, facts);
    if (invalid) return fail(invalid.code, invalid.extra);
    const blocked = screenLipSyncFacts(subject.key, facts);
    if (blocked) return fail(blocked.code, blocked.extra);

    const ownerId = subjectOwnerId(subject);
    const existing = await findJobByRequestId(subject, clientRequestId);
    if (existing) {
      const opened = existing.status === "queued" ? await openLipSyncJob(ctx, { clientRequestId, facts, lineage: null }) : null;
      return NextResponse.json({ job: jobToView(existing, storedErrorMessage), created: false, uploads: opened && "uploads" in opened ? opened.uploads : null });
    }
    await supersedeOwnDrafts(ownerId, feature.id);
    // one open job per concurrency slot (the Character Replace rule, no batch queue here)
    const cap = concurrencyLimitFor(settings.frenzAiCharacterReplace, { audience: entitlement.audience, isAdmin: !!adminUser, policyMaxConcurrent: entitlement.maxConcurrent });
    const open = await countOpenLipSyncJobs(subject, feature);
    if (open >= cap) return fail("JOB_ALREADY_PROCESSING");

    let lineage: { projectId: string; attempt: number; retryOf: string } | null = null;
    if (retryOf) {
      const prior = await getOwnJob(subject, retryOf);
      if (!prior || prior.feature !== feature.id) return fail("JOB_NOT_FOUND");
      const attempt = Number((prior.metadata as { attempt?: unknown } | null)?.attempt ?? 1);
      lineage = { projectId: typeof prior.metadata?.project_id === "string" ? prior.metadata.project_id : prior.id, attempt: (Number.isFinite(attempt) ? attempt : 1) + 1, retryOf: prior.id };
    }
    const opened = await openLipSyncJob(ctx, { clientRequestId, facts, lineage });
    if ("ok" in opened) return fail(opened.code, opened.extra);
    console.info("[lipsync/jobs] opened", { jobId: opened.row.id, userId: ownerId, source: facts.speech.source, durationMs: facts.video.durationMs, retryOf: retryOf ?? null });
    return NextResponse.json({ job: jobToView(opened.row, storedErrorMessage), created: opened.created, uploads: opened.uploads }, { status: opened.created ? 201 : 200 });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[lipsync/jobs] create failed", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
