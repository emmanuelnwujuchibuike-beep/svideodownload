import { NextResponse } from "next/server";

import { aiFeature } from "@/lib/ai/jobs";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signResultUrl } from "@/lib/ai/storage-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { subjectOwnerId } from "@/lib/ai/subject";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/jobs/[id]/result — a short-lived link to the cleaned video.
 *
 * ── 🔴 A SIGNED URL IS AUTHORITY OVER A FILE ─────────────────────────────────
 *
 * The private bucket has no read policy, so this endpoint is the only way in —
 * which makes every check here load-bearing rather than defensive:
 *
 *   1. there is a session;
 *   2. the job is THIS member's (read as them, so RLS decides, plus an id
 *      filter);
 *   3. the job is genuinely `completed` — a queued or failed job has nothing to
 *      hand over, and saying so beats signing a path that holds no file;
 *   4. the stored path really belongs to this member and this job. The path
 *      comes from the row, not the request, and this is the second check on
 *      the same fact — the one that still holds if a bad write ever put a
 *      foreign key in a row.
 *
 * The link expires in minutes (AI_SIGNED_URL_TTL_SECONDS), so one pasted into a
 * chat or captured in a log stops working before it can be passed around. The
 * member can always ask for another.
 *
 * `no-store`, because a cached signed URL outlives the reason it was issued.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feat = aiFeature("ai_clean");
  if (!feat) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }
  // A guest owns their result exactly as a member does — see the note in
  // lib/ai/job-store.ts on why the signed cookie replaces RLS here.
  const resolution = await resolveAiSubject(request, feat.id);
  const { subject } = resolution;

  const burst = await aiJobReadLimiter.limit(`ai-result:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  }

  try {
    const job = await getOwnJob(subject, id);
    // Somebody else's job answers exactly as a job that does not exist.
    if (!job) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    if (job.status === "expired") {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That video has expired." }), {
        status: aiErrorStatus("JOB_NOT_FOUND"),
      });
    }
    if (job.status !== "completed" || !job.result_path) {
      return NextResponse.json(
        aiErrorBody("JOB_NOT_FOUND", { error: "That video isn't ready yet." }),
        { status: 409 },
      );
    }

    if (!pathBelongsTo(job.result_path, subjectOwnerId(subject), job.id)) {
      console.error("[ai/result] stored path failed ownership", { jobId: job.id, subject: subject.key });
      return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
    }

    const signed = await signResultUrl(job.result_path);
    return NextResponse.json(
      { url: signed.url, expiresIn: signed.expiresIn, size: job.result_size },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/result] threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
