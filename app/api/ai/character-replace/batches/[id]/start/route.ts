import { NextResponse } from "next/server";

import { summarizeBatch } from "@/lib/ai/character-replace/batch";
import { startCharacterReplaceBatchSchema } from "@/lib/ai/character-replace/batch-schema";
import { getCharacterReplaceFreeEligibility } from "@/lib/ai/character-replace/free-access";
import { requestQueuePump } from "@/lib/ai/character-replace/queue-signal";
import { loadStartShared, startCharacterReplaceJob } from "@/lib/ai/character-replace/start-job";
import { getCharacterReplaceBalanceCents } from "@/lib/ai/character-replace/wallet";
import { aiErrorBody, aiErrorMessage, aiErrorStatus, isAiJobError, storedErrorMessage, type AiErrorCode } from "@/lib/ai/errors";
import { aiFeature, jobToView, type AiJobView } from "@/lib/ai/jobs";
import { listOwnBatchJobs } from "@/lib/ai/job-store";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/batches/[id]/start — "Process N videos"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (brief §5): validate the member, their access, their
 * allowance; count the videos; work out what the paid ones need; reserve
 * safely; create the jobs; start processing — and never charge twice for
 * retries, refreshes, double-clicks or replays.
 *
 * Every video runs THE start sequence (lib/ai/character-replace/start-job.ts),
 * in batch order, one after another: its own quote verified and recomputed,
 * its own preflight pass, its own atomic claim and its own atomic
 * reservation. The first videos take the member's free slots and go to the
 * worker now; the rest are `waiting` — paid for, in line — and the pump
 * starts each as a slot frees. A complimentary creation is decided per
 * video by the same rule as ever, so "two free, then paid" falls out of the
 * order rather than being special-cased.
 *
 * ── Idempotent by construction ─────────────────────────────────────────────
 * A job that already left `queued` answers "already started" and is skipped;
 * the claim is a compare-and-set and the reservation is one per job id. A
 * replay of this request reserves nothing again.
 *
 * ── The pre-check ───────────────────────────────────────────────────────────
 * Before anything is reserved, the batch's paid total (the quotes' totals
 * minus the complimentary creations the member still has) is compared with
 * the balance, so a member two videos short is told up front instead of
 * having three start and two refuse. The per-video atomic reservation
 * remains the real guard; this is the honest answer, not the authority.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

interface StartResult {
  jobId: string;
  ok: boolean;
  started: boolean;
  waiting: boolean;
  billing: "free" | "paid" | null;
  code: AiErrorCode | null;
  error: string | null;
  job: AiJobView | null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-cr-batch-start:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }
  const { id: batchId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(batchId)) return fail("JOB_NOT_FOUND");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = startCharacterReplaceBatchSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");

  try {
    const rows = await listOwnBatchJobs(subject, batchId);
    if (rows.length === 0) return fail("JOB_NOT_FOUND");
    // Only this batch's own jobs may be started through it — a foreign id in the body is "not found", exactly as a foreign job id is anywhere else.
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const j of parsed.data.jobs) if (!byId.has(j.jobId)) return fail("JOB_NOT_FOUND");

    const shared = await loadStartShared(subject, feature);
    const config = shared.settings.frenzAiCharacterReplace;
    if (!config.processing.queueEnabled && parsed.data.jobs.length > 1) return fail("CR_QUEUE_OFF");

    /* ── the pre-check: can the balance cover the paid part? ─────────────── */
    const pending = parsed.data.jobs.filter((j) => byId.get(j.jobId)?.status === "queued");
    const [balance, eligibility] = await Promise.all([getCharacterReplaceBalanceCents(subject.userId).catch(() => null), getCharacterReplaceFreeEligibility({ subject, config, request, isAdmin: shared.isAdmin })]);
    if (balance === null) return fail("INTERNAL_ERROR");
    // Null = unlimited (an administrator); otherwise the complimentary creations cover the FIRST videos (the per-video rule decides for real).
    const freeLeft = eligibility.eligible ? eligibility.remainingFreeUses : 0;
    const paidCents = pending
      .map((j) => j.quote.totalCents)
      .slice(freeLeft === null ? pending.length : Math.min(freeLeft, pending.length))
      .reduce((sum, cents) => sum + cents, 0);
    if (paidCents > balance) {
      return fail("CR_BALANCE_REQUIRED", { balanceCents: balance, requiredCents: paidCents, shortfallCents: paidCents - balance, currency: shared.settings.frenzAiCurrency, videos: pending.length });
    }

    /* ── every video, in batch order, through THE start ──────────────────── */
    const ordered = [...parsed.data.jobs].sort((a, b) => (byId.get(a.jobId)?.batch_index ?? 0) - (byId.get(b.jobId)?.batch_index ?? 0));
    const results: StartResult[] = [];
    let balanceCents: number | null = balance;
    for (const item of ordered) {
      const outcome = await startCharacterReplaceJob({
        subject,
        request,
        jobId: item.jobId,
        body: { quote: item.quote, trim: null, consent: true, preflightToken: item.preflightToken, voice: item.voice },
        queue: true,
        shared,
        via: "batch",
      });
      if (!outcome.ok) {
        results.push({ jobId: item.jobId, ok: false, started: false, waiting: false, billing: null, code: outcome.code, error: typeof outcome.extra?.error === "string" ? outcome.extra.error : aiErrorMessage(outcome.code), job: null });
        // A refused balance ends the run: every later video would refuse the same way, and the member should recharge once, not N times.
        if (outcome.code === "CR_BALANCE_REQUIRED" || outcome.code === "CR_DAILY_LIMIT" || outcome.code === "CR_BUSY" || outcome.code === "CR_MAINTENANCE") break;
        continue;
      }
      if ("alreadyStarted" in outcome) {
        results.push({ jobId: item.jobId, ok: true, started: false, waiting: outcome.job.status === "waiting", billing: null, code: null, error: null, job: jobToView(outcome.job, storedErrorMessage) });
        continue;
      }
      if (outcome.balanceCents !== null) balanceCents = outcome.balanceCents;
      results.push({ jobId: item.jobId, ok: true, started: outcome.started, waiting: outcome.waiting, billing: outcome.billing, code: null, error: null, job: jobToView(outcome.job, storedErrorMessage) });
    }

    // Anything waiting: look at the line now (race-safe; the earlier videos may have taken every slot, which is the point).
    if (results.some((r) => r.waiting)) requestQueuePump(subject.userId, "batch-start");

    const fresh = await listOwnBatchJobs(subject, batchId);
    const views = fresh.map((r) => jobToView(r, storedErrorMessage));
    console.info("[cr/batch] started", { batchId, userId: subject.userId, requested: parsed.data.jobs.length, started: results.filter((r) => r.started).length, waiting: results.filter((r) => r.waiting).length, refused: results.filter((r) => !r.ok).map((r) => r.code), balanceCents });
    return NextResponse.json({ batch: summarizeBatch(batchId, views), jobs: views, results, balanceCents });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/batch] start failed", { subject: subject.key, batchId, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/batch] start threw", { subject: subject.key, batchId, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
