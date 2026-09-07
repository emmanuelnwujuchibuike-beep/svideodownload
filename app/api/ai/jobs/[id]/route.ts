import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { jobToView } from "@/lib/ai/jobs";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/jobs/[id] — one job, if it is yours.
 *
 * ── 🔴 "NOT FOUND", NEVER "NOT YOURS" ────────────────────────────────────────
 *
 * A job belonging to someone else answers exactly as a job that does not exist:
 * same status, same sentence, same shape. The alternative — 403 for a real
 * id, 404 for an imaginary one — turns this endpoint into an oracle that
 * confirms which ids are real, which is a fact nobody outside the owner is
 * entitled to and one that costs nothing to withhold.
 *
 * Ownership is enforced twice over and neither is a formality: the read runs as
 * the member (so `ai_jobs_select_own` decides) AND filters by their id. See
 * lib/ai/job-store.ts for why that pairing is the stronger one.
 *
 * ── What comes back ──────────────────────────────────────────────────────────
 *
 * `jobToView` is an allow-list. `provider`, `model`, `model_version`,
 * `replicate_prediction_id`, both storage paths, `error_message` and `metadata`
 * never leave the server — the first four are the makings of an attack on the
 * provider account, the paths are private-bucket keys, and the message is
 * whatever a provider chose to say, which is not fit to be shown to anyone.
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
    /* treated as anonymous */
  }
  if (!userId) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-read:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  // Checked before it reaches the database: a malformed id is a 404 answered
  // from memory rather than a query that can only ever return nothing.
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  }

  try {
    const row = await getOwnJob(userId, id);
    if (!row) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }
    return NextResponse.json({ job: jobToView(row, storedErrorMessage) });
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/jobs] get threw", { userId, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
