import { NextResponse } from "next/server";
import { z } from "zod";

import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { jobToView, primaryAiFeature } from "@/lib/ai/jobs";
import { recordJobEvent } from "@/lib/ai/job-events";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/jobs/[id]/save — keep this result (Part 7 §9, §21).
 *
 * "Save to FrenzSave" means one concrete thing here: the finished video is
 * kept for the operator's SAVED window (`retention.savedResultDays`, 30 days
 * by default) instead of the ordinary result window (72 hours), and history
 * marks it. Nothing is copied — the same object in the results bucket is
 * referenced, the row's `expires_at` moves and `metadata.saved_at` is set.
 * Un-saving (`{ saved: false }`) puts the ordinary window back, measured
 * from the completion, never earlier than an hour from now.
 *
 * Owner only (`getOwnJob` runs as the member), finished jobs only, and —
 * §34 — this touches no balance: saving is not a charge.
 */
const schema = z.object({ saved: z.boolean() }).strict();

function fail(code: Parameters<typeof aiErrorBody>[0]) {
  return NextResponse.json(aiErrorBody(code), { status: aiErrorStatus(code) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = primaryAiFeature();
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-save:${subject.key}`);
  if (!burst.success) return fail("RATE_LIMITED");
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");

  try {
    const job = await getOwnJob(subject, id);
    // 🔴 "Not found", never "not yours": a job belonging to someone else answers exactly as one that does not exist.
    if (!job || job.status !== "completed" || !job.result_path) return fail("JOB_NOT_FOUND");
    const settings = await getLandingSettings();
    const { resultHours, savedResultDays } = settings.frenzAiCharacterReplace.retention;
    const now = Date.now();
    const completedAt = Date.parse(job.completed_at ?? job.created_at);
    const expiresAt = parsed.data.saved
      ? new Date(Math.max(now + savedResultDays * 86_400_000, Date.parse(job.expires_at ?? "") || 0)).toISOString()
      : new Date(Math.max(now + 3_600_000, (Number.isFinite(completedAt) ? completedAt : now) + resultHours * 3_600_000)).toISOString();
    const { data, error } = await createAdminClient()
      .from("ai_jobs")
      .update({ expires_at: expiresAt, metadata: { ...(job.metadata ?? {}), saved_at: parsed.data.saved ? new Date(now).toISOString() : null } })
      .eq("id", job.id)
      .eq("status", "completed")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail("JOB_NOT_FOUND");
    await recordJobEvent(job.id, parsed.data.saved ? "result.saved" : "result.unsaved", { expiresAt }, `member:${subject.userId}`);
    const fresh = await getOwnJob(subject, id);
    return NextResponse.json({ job: jobToView(fresh ?? job, storedErrorMessage), saved: parsed.data.saved, expiresAt });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[ai/jobs/save] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
