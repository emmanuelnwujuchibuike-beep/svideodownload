import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { FINALIZE_MAX_ATTEMPTS } from "@/lib/ai/character-replace/finalize-policy";
import { characterReplaceRefundState, refundCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { listJobEvents, recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { isActiveStatus } from "@/lib/ai/jobs";
import { notifyAiJobFromRow } from "@/lib/ai/notify";
import { reconcileWithProvider } from "@/lib/ai/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /api/admin/ai/character-replace/jobs/[id]/recover — the operator's hands
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 5 (§35): "Safe recovery actions — retry finalization, reconcile with
 * provider, retry notification, mark as failed and refund (only after
 * verified failure)… All admin actions must require confirmation and be
 * logged."
 *
 * GET  → the job's audit trail (ai_job_events), newest first.
 * POST → one action, with a reason, recorded as `admin.<action>` with the
 *        operator's id before anything moves.
 *
 * Every action reuses the live path: the same worker dispatch, the same
 * reconciler, the same notifier, the same idempotent refund. Nothing here
 * can complete a job by hand, set a price, or move money except a refund
 * of a charge the ledger still holds for a job that has already failed.
 */
const schema = z
  .object({
    action: z.enum(["retry_finalization", "reconcile", "retry_notification", "refund"]),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();



export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const events = await listJobEvents(id, 60);
  return NextResponse.json({ events });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pick an action and give a reason." }, { status: 400 });
  const { action, reason } = parsed.data;

  const job = await getJobAsService(id);
  if (!job || job.feature !== "ai_character_replace") return NextResponse.json({ error: "No such Character Replace job." }, { status: 404 });
  const actor = `admin:${admin.id}`;
  const providerUrl = typeof job.metadata?.provider_output_url === "string" ? job.metadata.provider_output_url : null;

  try {
    switch (action) {
      case "retry_finalization": {
        if (!(job.status === "processing" || job.status === "finalizing") || !providerUrl) {
          return NextResponse.json({ error: "Only a job with a recorded provider output, still processing or finalizing, can be re-finalized." }, { status: 409 });
        }
        if (job.finalize_lease_until && Date.parse(job.finalize_lease_until) > Date.now()) {
          return NextResponse.json({ error: "A finalizer holds this job right now — wait for its lease to expire." }, { status: 409 });
        }
        await recordJobEvent(id, "admin.retry_finalization", { reason, attemptsSoFar: job.finalize_attempts }, actor);
        // Clear the backoff; if every attempt is spent, grant exactly one more.
        const { error } = await createAdminClient()
          .from("ai_jobs")
          .update({
            finalize_next_at: null,
            finalize_lease_until: null,
            ...(job.finalize_attempts >= FINALIZE_MAX_ATTEMPTS ? { finalize_attempts: FINALIZE_MAX_ATTEMPTS - 1 } : {}),
          })
          .eq("id", id)
          .in("status", ["processing", "finalizing"]);
        if (error) return NextResponse.json({ error: "Couldn't clear the retry schedule." }, { status: 500 });
        const dispatch = await dispatchFinalization(id);
        return NextResponse.json({
          ok: dispatch.dispatched,
          detail: dispatch.dispatched ? "Finalization re-dispatched to the worker." : `The worker did not take it: ${dispatch.reason}.`,
        });
      }
      case "reconcile": {
        if (!job.replicate_prediction_id || !(job.status === "queued" || job.status === "processing")) {
          return NextResponse.json({ error: "Only a queued or processing job with a prediction id can be reconciled." }, { status: 409 });
        }
        await recordJobEvent(id, "admin.reconcile", { reason, predictionId: job.replicate_prediction_id }, actor);
        const changed = await reconcileWithProvider(job, Date.now(), { force: true });
        const fresh = await getJobAsService(id);
        return NextResponse.json({
          ok: true,
          detail: changed ? `The provider's answer moved the job to ${fresh?.status ?? "?"}.` : "The provider still reports it running; nothing changed.",
        });
      }
      case "retry_notification": {
        if (isActiveStatus(job.status) || !job.user_id) return NextResponse.json({ error: "Only a finished member job can be re-announced." }, { status: 409 });
        await recordJobEvent(id, "admin.retry_notification", { reason, previouslyNotifiedAt: job.notified_at }, actor);
        // Release the once-only claim on purpose — this is the operator saying "send it again".
        const { error } = await createAdminClient().from("ai_jobs").update({ notified_at: null }).eq("id", id);
        if (error) return NextResponse.json({ error: "Couldn't release the notification claim." }, { status: 500 });
        const outcome = await notifyAiJobFromRow(id, { local: true });
        return NextResponse.json({ ok: outcome === "sent", detail: outcome === "sent" ? "Notification sent through the usual path." : `Not sent: ${outcome}.` });
      }
      case "refund": {
        if (!(job.status === "failed" || job.status === "cancelled" || job.status === "expired") || !job.user_id) {
          return NextResponse.json({ error: "A refund here is only for a job that has already failed. A completed job's charge is adjusted from the balance tool." }, { status: 409 });
        }
        const state = await characterReplaceRefundState(job.user_id, id);
        if (state === "refunded") return NextResponse.json({ ok: true, detail: "Already refunded — the ledger shows it." });
        if (state === "none") return NextResponse.json({ error: "This job was never charged." }, { status: 409 });
        await recordJobEvent(id, "admin.refund", { reason, ledgerState: state, chargedCents: job.charged_cents }, actor);
        const balance = await refundCharacterReplaceCharge(job.user_id, id, `admin: ${reason}`);
        await recordJobEvent(id, "refund.issued", { reason: "admin", chargedCents: job.charged_cents, from: "admin" }, actor);
        return NextResponse.json({ ok: balance !== null, detail: balance !== null ? "Refunded through the ledger." : "The ledger refused the refund — see the server log." });
      }
    }
  } catch (e) {
    console.error("[admin/cr-recover] threw", { jobId: id, action, error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "The action threw; nothing further was changed." }, { status: 500 });
  }
}
