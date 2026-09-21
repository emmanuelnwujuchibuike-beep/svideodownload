import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { creditLedgerFor } from "@/lib/ai/credits/store";
import { characterReplaceRefundState } from "@/lib/ai/character-replace/wallet";
import { getOwnJob } from "@/lib/ai/job-store";
import { isWalletFundedFeature, isActiveStatus, jobToView, primaryAiFeature, type AiJobRow, type AiJobView } from "@/lib/ai/jobs";
import { notifyAiJobFromRow } from "@/lib/ai/notify";
import { reconcileWithProvider } from "@/lib/ai/reconcile";
import { recoverJob, recoveryDue } from "@/lib/ai/recovery";
import { failStalledJob } from "@/lib/ai/stall-server";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";
import { deleteAiJobResult } from "@/lib/ai/retention";
import { recordJobEvent } from "@/lib/ai/job-events";

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
/**
 * The view, plus two things only a Character Replace job needs (Part 5):
 *
 *   · the refund state from the LEDGER — "pending" while a failed job's
 *     charge is still reserved, "refunded" once it came back — so the
 *     failure screen never claims a refund the ledger has not made (§29);
 *   · the notification fallback: a terminal job whose announcement was left
 *     `notify_pending` (the worker had no push keys and could not reach the
 *     frontend) is announced HERE, on the member's own poll, from the process
 *     that holds the keys. Idempotent through the claim (§21).
 */
async function viewWithMoney(row: AiJobRow): Promise<AiJobView> {
  const view = jobToView(row, storedErrorMessage);
  if (!isWalletFundedFeature(row.feature) || !row.user_id) return view;
  const terminal = !isActiveStatus(row.status);
  if (terminal && !row.notified_at && row.metadata?.notify_pending === true) {
    await notifyAiJobFromRow(row.id, { local: true }).catch((e) => console.error("[ai/jobs] pending notify failed", { jobId: row.id, error: String(e) }));
  }
  if ((view.characterReplace || view.lipSync) && terminal && (row.charged_cents ?? 0) > 0) {
    const state = await characterReplaceRefundState(row.user_id, row.id);
    if (view.characterReplace) view.characterReplace = { ...view.characterReplace, refunded: state === "refunded", refundPending: state === "pending" };
    if (view.lipSync) view.lipSync = { ...view.lipSync, refunded: state === "refunded", refundPending: state === "pending" };
  }
  // 0167: a job paid with included credits — whether they came back, from the credit ledger, never a status
  if ((view.characterReplace || view.lipSync) && terminal && row.funding_source === "credits") {
    const ledger = await creditLedgerFor([row.id]);
    const released = ledger.get(row.id)?.status === "released";
    if (view.characterReplace) view.characterReplace = { ...view.characterReplace, creditsReleased: released, refunded: released };
    if (view.lipSync) view.lipSync = { ...view.lipSync, creditsReleased: released, refunded: released };
  }
  return view;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = primaryAiFeature();
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

  /*
    🔴 SIGNED IN, OR NOTHING (owner, 2026-09-09, standing Frenz AI rule).

    "Only authenticated/signed-in users can access Frenz AI. Logged-out users
    must not be able to open or use AI tools." `resolveAiSubject` returns null
    for anyone without a session, and the check lives in EVERY route rather
    than in a shared wrapper because §21 requires the backend to enforce this
    independently — a wrapper is one refactor away from being bypassed on one
    route and nobody noticing.

    AUTH_REQUIRED is 401: this is "sign in", not "you may not".
  */
  if (!subject) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

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
    /*
      ── 🔴 ASK THE PROVIDER, DON'T ONLY WAIT TO BE TOLD ──────────────────────

      Before the deadline, and much sooner than it: a job quiet for 90 seconds
      gets its real status read from Replicate. A webhook that is lost, refused
      or never sent used to mean `processing` for ever with nothing logged
      anywhere — three jobs died that way on 2026-09-08. Reading a prediction is
      a free GET, so this costs nothing but recovers everything.

      Compare-and-set on both sides, so a callback landing mid-flight and this
      cannot both act. See lib/ai/reconcile.ts.
    */
    /*
      ── Character Replace (Part 5): the SAME recovery step the cron runs ─────
      A finalization that failed on our side and is due its retry, or a
      provider output the worker never heard about, is re-dispatched the
      moment its owner looks — not at the next ten-minute tick. Throttled per
      job per instance; the worker's lease makes a duplicate dispatch a no-op.
    */
    const recovered = isWalletFundedFeature(row.feature) && recoveryDue(row.id) ? await recoverJob(row) : "none";
    const changed = recovered === "reconciled" || recovered === "stalled" || recovered === "gave-up" || (recovered === "none" && (await reconcileWithProvider(row)));

    // The deadline stays underneath as the last backstop, for the case where
    // the provider itself has lost the work.
    if (changed || (recovered === "none" && (await failStalledJob(row)))) {
      const fresh = await getOwnJob(subject, id);
      if (fresh) {
        return applyAiSubjectCookie(NextResponse.json({ job: await viewWithMoney(fresh) }), resolution);
      }
    }

    return applyAiSubjectCookie(NextResponse.json({ job: await viewWithMoney(row) }), resolution);
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/jobs] get threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/**
 * DELETE /api/ai/jobs/[id] — the member removes a finished result (Part 7 §20).
 *
 * Owner only, through the same `getOwnJob` read every other route uses (a
 * stranger's id is "not found"); terminal jobs only — a running job is
 * cancelled, not deleted. The files go, the paths are cleared, the row is
 * marked `deleted` and leaves history; the ledger is untouched (§34: no
 * balance moves because a result was deleted). An old result URL then
 * answers "This video has been deleted" to the owner and "not found" to
 * everyone else, exactly as before the deletion.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = primaryAiFeature();
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }
  const burst = await aiJobCreateLimiter.limit(`ai-delete:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED") });
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const row = await getOwnJob(subject, id);
    if (!row) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    if (isActiveStatus(row.status)) return NextResponse.json(aiErrorBody("JOB_ALREADY_PROCESSING", { error: "This video is still processing. Cancel it first." }), { status: aiErrorStatus("JOB_ALREADY_PROCESSING") });
    if (row.status === "deleted") return NextResponse.json({ job: jobToView(row, storedErrorMessage), deleted: true });
    const outcome = await deleteAiJobResult(row);
    await recordJobEvent(row.id, "result.deleted", { objectsDeleted: outcome.objectsDeleted, errors: outcome.errors, from: row.status }, `member:${subject.userId}`);
    const fresh = await getOwnJob(subject, id);
    return NextResponse.json({ job: jobToView(fresh ?? row, storedErrorMessage), deleted: outcome.deleted });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/jobs] delete threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
