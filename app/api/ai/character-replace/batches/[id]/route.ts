import { NextResponse } from "next/server";

import { summarizeBatch } from "@/lib/ai/character-replace/batch";
import { freeUseStates } from "@/lib/ai/character-replace/free-access";
import { characterReplaceRefundStates } from "@/lib/ai/character-replace/wallet";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isActiveStatus, jobToView, type AiJobRow } from "@/lib/ai/jobs";
import { getOwnJob, listOwnBatchJobs } from "@/lib/ai/job-store";
import { recoverJob, recoveryDue } from "@/lib/ai/recovery";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/character-replace/batches/[id] — one poll for every video in
 * the session (0166, brief §10, §14, §21).
 *
 * The board draws itself from THIS and nothing else: a refresh, a new tab,
 * another device all reconstruct the same picture, because the picture is
 * the rows. Read as the member (RLS: a stranger's batch id is an empty
 * list, answered as not found). One request for N jobs rather than N polls;
 * the client backs off exactly as the single-job watch does.
 *
 * The same self-healing step the single-job read runs, per live row,
 * throttled per job: a missed webhook is read from the provider, a due
 * finalization re-dispatched, a stalled row ended — at the first moment
 * somebody is actually looking.
 */
function fail(code: Parameters<typeof aiErrorBody>[0]) {
  return NextResponse.json(aiErrorBody(code), { status: aiErrorStatus(code) });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobReadLimiter.limit(`ai-cr-batch:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  try {
    let rows = await listOwnBatchJobs(subject, id);
    if (rows.length === 0) return fail("JOB_NOT_FOUND");

    // The recovery step, per live provider-side row, throttled per job (lib/ai/recovery.ts).
    rows = await Promise.all(
      rows.map(async (row): Promise<AiJobRow> => {
        if (!(row.status === "processing" || row.status === "finalizing" || row.status === "acquiring") || !recoveryDue(row.id)) return row;
        const action = await recoverJob(row);
        if (action === "none" || action === "working") return row;
        return (await getOwnJob(subject, row.id)) ?? row;
      }),
    );

    const views = rows.map((row) => jobToView(row, storedErrorMessage));
    // Part 7 §18 / Part 11 §24: the refund and the restored complimentary creation come from the LEDGER, never a status.
    const charged = rows.filter((r) => !isActiveStatus(r.status) && (r.charged_cents ?? 0) > 0).map((r) => r.id);
    const states = await characterReplaceRefundStates(subject.userId, charged);
    const free = rows.filter((r) => r.funding_source === "free" && !isActiveStatus(r.status)).map((r) => r.id);
    const freeStates = await freeUseStates(free);
    for (const view of views) {
      if (!view.characterReplace) continue;
      if (charged.includes(view.id)) {
        const state = states.get(view.id) ?? "none";
        view.characterReplace = { ...view.characterReplace, refunded: state === "refunded", refundPending: state === "pending" };
      }
      if (free.includes(view.id)) view.characterReplace = { ...view.characterReplace, freeRestored: freeStates.get(view.id) === "restored" };
    }
    return NextResponse.json({ batch: summarizeBatch(id, views), jobs: views });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[cr/batch] read threw", { subject: subject.key, batchId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
