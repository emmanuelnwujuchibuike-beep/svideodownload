import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceViewUrl } from "@/lib/ai/storage-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/jobs/[id]/source — a short-lived link to the member's ORIGINAL.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The before/after comparison needs both sides. Without it the interface can
 * only show the cleaned video and ask somebody to remember what the original
 * looked like — which is exactly the claim a text-removal tool should be able
 * to prove rather than assert.
 *
 * ── 🔴 IT IS THE RESULT ENDPOINT'S RULES, VERBATIM ───────────────────────────
 *
 * Same session check, same ownership read (as the member, so RLS decides, plus
 * an explicit id filter), same `pathBelongsTo` re-check on the stored path,
 * same short expiry, same `no-store`. A source file is not less private than a
 * result — it is the member's unpublished footage, and it is the one this
 * product never asked permission to publish.
 *
 * The one difference: this is offered for a COMPLETED job only. Before that,
 * the browser still has the file it uploaded and does not need us to hand it
 * back; afterwards, it usually does not.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous */
  }
  if (!userId) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-source:${userId}`);
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
    const job = await getOwnJob(userId, id);
    // Somebody else's job answers exactly as one that does not exist.
    if (!job || !job.source_path) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    if (job.status !== "completed") {
      return NextResponse.json(
        aiErrorBody("JOB_NOT_FOUND", { error: "That video isn't ready yet." }),
        { status: 409 },
      );
    }

    if (!pathBelongsTo(job.source_path, userId, job.id)) {
      console.error("[ai/source] stored path failed ownership", { jobId: job.id, userId });
      return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
    }

    const signed = await signSourceViewUrl(job.source_path);
    return NextResponse.json(
      { url: signed.url, expiresIn: signed.expiresIn },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/source] threw", { userId, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
