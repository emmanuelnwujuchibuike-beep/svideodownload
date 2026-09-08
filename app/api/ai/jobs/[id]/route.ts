import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { failStalledJob } from "@/lib/ai/stall-server";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";

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
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_clean");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  /*
    🔴 A GUEST POLLS THEIR OWN JOB. There is no session to require — the signed
    cookie identifies them, and `getOwnJob` scopes the read to it. Requiring
    auth here would mean a signed-out visitor could start a job and never be
    able to watch it finish.
  */
  const resolution = await resolveAiSubject(request, feature.id);
  const { subject } = resolution;

  const burst = await aiJobReadLimiter.limit(`ai-read:${subject.key}`);
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
    const row = await getOwnJob(subject, id);
    if (!row) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    /*
      ── 🔴 THE DEADLINE IS ENFORCED HERE, ON THE POLL ────────────────────────

      A job whose provider callback never arrives has nothing else that could
      ever end it: no cron sweeps `ai_jobs` (both Vercel slots are spent), the
      webhook is the thing that is missing, and the worker only speaks about
      jobs it received. Before this, such a row stayed `processing` forever —
      an endless spinner for the member and a daily allowance slot reserved
      for nobody. See lib/ai/stall.ts for the deadlines and why they are long.

      Doing it on the read costs one comparison on a row already in hand, and
      it reaches the one person who is actually waiting, at the first moment
      there is anything to tell them. `failStalledJob` is compare-and-set, so
      two tabs polling together still produce exactly one refund.
    */
    if (await failStalledJob(row)) {
      const ended = await getOwnJob(subject, id);
      if (ended) {
        return applyAiSubjectCookie(
          NextResponse.json({ job: jobToView(ended, storedErrorMessage) }),
          resolution,
        );
      }
    }

    return applyAiSubjectCookie(
      NextResponse.json({ job: jobToView(row, storedErrorMessage) }),
      resolution,
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/jobs] get threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
