import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summarizeCharacterReplaceJobs, type CharacterReplaceAdminJob } from "../admin-stats";
import { aiNotificationCopy } from "../notification-copy";
import { FINALIZE_BACKOFF_MS, FINALIZE_LEASE_SECONDS, FINALIZE_MAX_ATTEMPTS, finalizeBackoffMs, isTransientFinalizeFailure } from "./finalize-policy";
import { createCharacterReplaceJobSchema } from "./start-schema";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — PART 5: background jobs, push, reliable completion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The pure policy is tested directly. The wiring — which function is called
 * before which, which predicate the claim carries, what the cron requires —
 * is tested by reading the source, the way every other wiring test in this
 * project does, so a refactor that quietly drops a guarantee goes red here
 * rather than in production at three in the morning.
 */
const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/* ───────────────────────── the retry policy (§10–§11) ───────────────────── */

describe("finalization retry policy — bounded, backed off, only for OUR failures", () => {
  it("three attempts inside the provider's one-hour output window, a lease shorter than a stall deadline", () => {
    expect(FINALIZE_MAX_ATTEMPTS).toBe(3);
    expect(FINALIZE_LEASE_SECONDS).toBeLessThanOrEqual(20 * 60);
    const total = FINALIZE_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(60 * 60_000);
  });

  it("backs off longer after each failure and never throws on an odd attempt number", () => {
    expect(finalizeBackoffMs(1)).toBe(60_000);
    expect(finalizeBackoffMs(2)).toBe(5 * 60_000);
    expect(finalizeBackoffMs(9)).toBe(5 * 60_000);
    expect(finalizeBackoffMs(0)).toBe(60_000);
  });

  it("storage and worker failures retry; a wrong or expired provider file does not", () => {
    expect(isTransientFinalizeFailure("FINAL_UPLOAD_FAILED", "bucket said no")).toBe(true);
    expect(isTransientFinalizeFailure("AI_FINALIZATION_FAILED", "TypeError: x")).toBe(true);
    expect(isTransientFinalizeFailure("INVALID_AI_OUTPUT", "download: Error: the provider's download stalled or exceeded its budget")).toBe(true);
    expect(isTransientFinalizeFailure("INVALID_AI_OUTPUT", "download: Error: download failed: 404")).toBe(false);
    expect(isTransientFinalizeFailure("INVALID_AI_OUTPUT", "download: Error: download failed: 410")).toBe(false);
    expect(isTransientFinalizeFailure("INVALID_AI_OUTPUT", "the provider's output has no readable video stream")).toBe(false);
    expect(isTransientFinalizeFailure("INVALID_AI_OUTPUT", "expected about 3000 ms, the output is 900 ms")).toBe(false);
  });
});

/* ───────────────────────── the finalizer's order of operations ──────────── */

describe("the finalizer — a lease, and nobody is told 'ready' before the file is ours", () => {
  const s = src("server/services/ai-character-replace-finalize-service.ts");

  it("claims through the lease, not a bare status transition", () => {
    expect(s).toContain("claimFinalization(jobId, { leaseSeconds: FINALIZE_LEASE_SECONDS, maxAttempts: FINALIZE_MAX_ATTEMPTS })");
    expect(s).not.toMatch(/transitionJob\(jobId, \["processing"\], "finalizing"\)/);
  });

  it("stores the result, completes the row, settles, THEN notifies", () => {
    const upload = s.indexOf("uploadFinalResult({");
    const complete = s.indexOf('"completed", {');
    const settle = s.indexOf("settleCharacterReplaceCharge(ownerId, jobId)");
    const notify = s.indexOf("notifyAiJobFinished({");
    expect(upload).toBeGreaterThan(0);
    expect(complete).toBeGreaterThan(upload);
    expect(settle).toBeGreaterThan(complete);
    expect(notify).toBeGreaterThan(settle);
  });

  it("a transient failure schedules a retry and keeps the provider URL; only a permanent one or the last attempt refunds", () => {
    expect(s).toContain("isTransientFinalizeFailure(failure.code, failure.detail)");
    expect(s).toContain("if (transient && attempt < FINALIZE_MAX_ATTEMPTS) {");
    expect(s).toContain("scheduleFinalizationRetry(jobId, { nextAt");
    // The retry branch returns before failFinalize is reached.
    const retry = s.indexOf("scheduleFinalizationRetry(jobId, { nextAt");
    const giveUp = s.indexOf("await failFinalize(job, failure, { exhausted: transient })");
    expect(retry).toBeGreaterThan(0);
    expect(giveUp).toBeGreaterThan(retry);
    expect(s.slice(retry, giveUp)).toContain("return { ok: false, jobId, code: failure.code, detail: `retry scheduled:");
    // The retry branch never touches the money or the member.
    expect(s.slice(retry, giveUp)).not.toContain("releaseJobFunding");
    expect(s.slice(retry, giveUp)).not.toContain("notifyAiJobFailed");
  });

  it("the refund is the idempotent product-wallet path and is recorded in the audit log", () => {
    const fail = s.slice(s.indexOf("async function failFinalize"));
    expect(fail).toContain('releaseJobFunding({ job: updated, subject, feature: "ai_character_replace"');
    expect(fail).toContain('recordJobEvent(job.id, "refund.issued"');
    expect(fail.indexOf('"refund.issued"')).toBeGreaterThan(fail.indexOf("releaseJobFunding("));
  });
});

/* ───────────────────────── the claim itself ─────────────────────────────── */

describe("claimFinalization — one owner, counted attempts, in one UPDATE", () => {
  const s = src("lib/ai/job-store.ts");
  const claim = s.slice(s.indexOf("export async function claimFinalization"), s.indexOf("export async function scheduleFinalizationRetry"));

  it("is a compare-and-set on status, attempts and the lease", () => {
    expect(claim).toContain('.in("status", ["processing", "finalizing"])');
    expect(claim).toContain('.eq("finalize_attempts", row.finalize_attempts)');
    expect(claim).toContain("finalize_lease_until.is.null,finalize_lease_until.lte.");
    expect(claim).toContain("finalize_attempts: row.finalize_attempts + 1");
  });

  it("refuses before writing when exhausted, leased, or not yet due", () => {
    expect(claim).toContain('return { claimed: null, reason: "exhausted" }');
    expect(claim).toContain('return { claimed: null, reason: "leased" }');
    expect(claim).toContain('return { claimed: null, reason: "not-due" }');
  });

  it("the new columns are selected — a column that is not named is undefined, not null", () => {
    expect(s).toContain("finalize_attempts, finalize_lease_until, finalize_next_at, finalize_error, metadata");
  });
});

/* ───────────────────────── recovery + the cron (§12–§13, §33) ───────────── */

describe("the recovery sweep — the same functions the live paths use, and nothing for AI Clean", () => {
  const s = src("lib/ai/recovery.ts");
  it("re-dispatches through the one worker route, reconciles through the one reconciler, stalls through the one sweep", () => {
    expect(s).toContain("dispatchFinalization(row.id)");
    expect(s).toContain("reconcileWithProvider(row, now)");
    expect(s).toContain("failStalledJob(row, now)");
    expect(s).toContain("notifyAiJobFromRow(row.id, { local: true })");
  });
  it("only Character Replace rows enter the lease/retry branches", () => {
    expect(s).toContain('const retryable = row.feature === "ai_character_replace";');
    expect(s).toContain('if (row.status === "finalizing" && retryable) {');
    expect(s).toContain('if (row.status === "processing" && providerUrl && retryable) {');
  });
  it("a job still under lease is left alone", () => {
    expect(s).toContain('if (leased) return "working";');
  });
  it("giving up ends the job from finalizing, refunds once through the product wallet, and tells the member once", () => {
    const give = s.slice(s.indexOf("export async function giveUpFinalization"));
    expect(give).toContain('transitionJob(row.id, ["finalizing"], "failed"');
    expect(give).toContain('feature: "ai_character_replace"');
    expect(give).toContain("notifyAiJobFailed({");
  });

  it("the cron route is authorised like every other cron and is NOT in vercel.json", () => {
    const route = src("app/api/cron/ai-reconcile/route.ts");
    expect(route).toContain("cronAuthorized(request)");
    expect(route).toContain("sweepAiJobs()");
    expect(src("vercel.json")).not.toContain("ai-reconcile");
    const wf = src(".github/workflows/cron-ai-reconcile.yml");
    expect(wf).toContain("/api/cron/ai-reconcile");
    expect(wf).toContain("secrets.CRON_SECRET");
    expect(wf).toMatch(/cron: "\*\/10 \* \* \* \*"/);
  });

  it("the member's poll runs the same step, throttled, for Character Replace only", () => {
    const poll = src("app/api/ai/jobs/[id]/route.ts");
    expect(poll).toContain('row.feature === "ai_character_replace" && recoveryDue(row.id) ? await recoverJob(row)');
    expect(poll).toContain("RECOVERY_EVERY_MS = 30_000");
  });
});

/* ───────────────────────── the webhook (§9) ─────────────────────────────── */

describe("the webhook — verified, located by a unique id, idempotent, audited", () => {
  const s = src("app/api/ai/replicate/webhook/route.ts");
  it("verifies the raw bytes before anything, and answers 200 to a refusal", () => {
    expect(s.indexOf("await request.text()")).toBeLessThan(s.indexOf("verifyReplicateWebhook({"));
    expect(s.indexOf("verifyReplicateWebhook({")).toBeLessThan(s.indexOf("findJobByPredictionId("));
  });
  it("records received vs ignored (duplicate / out of order) before any transition", () => {
    const audit = s.indexOf('stale ? "webhook.ignored" : "webhook.received"');
    expect(audit).toBeGreaterThan(0);
    expect(audit).toBeLessThan(s.indexOf('transitionJob(job.id, ["queued"], "processing"'));
  });
  it("every state change is a compare-and-set from the statuses it may leave", () => {
    expect(s).toContain('transitionJob(jobId, ["queued", "processing"], "failed"');
    expect(s).toContain('transitionJob(job.id, ["queued", "processing"], "cancelled"');
    expect(s).not.toMatch(/\.update\(\{ status:/);
  });
});

/* ───────────────────────── notifications (§14–§23) ──────────────────────── */

describe("notifications — the exact copy, one system, once per job, never load-bearing", () => {
  it("§16 completed and failed copy, with the refund said only when the ledger says so", () => {
    const done = aiNotificationCopy({ feature: "ai_character_replace", outcome: "completed" });
    expect(done.title).toBe("Your video is ready ✨");
    expect(done.body).toBe("Your Character Replace video has finished processing. Tap to view it.");
    const refunded = aiNotificationCopy({ feature: "ai_character_replace", outcome: "failed", refunded: true });
    expect(refunded.title).toBe("Character Replace couldn't finish");
    expect(refunded.body).toBe("Something went wrong while processing your video. Your balance has been refunded.");
    const pending = aiNotificationCopy({ feature: "ai_character_replace", outcome: "failed", refunded: false });
    expect(pending.body).not.toContain("has been refunded");
    expect(pending.body).toContain("being processed");
    const free = aiNotificationCopy({ feature: "ai_character_replace", outcome: "failed", refunded: null });
    expect(free.body).not.toContain("refunded");
  });

  it("uses the existing push system only — sendSmartPush, the downloads category, the claim, no second sender", () => {
    const s = src("lib/ai/notify.ts");
    expect(s).toContain("sendSmartPush(");
    expect(s).not.toContain("webpush.sendNotification");
    expect(s).not.toContain("sendPushToUser(");
    expect(s).toContain('"downloads"');
    // The claim (notified_at) is the dedupe record; it is taken before the send.
    const finished = s.slice(s.indexOf("export async function notifyAiJobFinished"), s.indexOf("export async function notifyAiJobFailed"));
    expect(finished.indexOf("claimAiNotification(opts.jobId)")).toBeLessThan(finished.indexOf("sendSmartPush("));
    // A process without keys hands off instead of claiming.
    expect(finished.indexOf("handOffIfNoKeys(opts.jobId, opts.local)")).toBeLessThan(finished.indexOf("claimAiNotification(opts.jobId)"));
    // A push that throws is caught — it never fails the job or the refund.
    expect(finished).toContain("catch (e)");
  });

  it("the deep link names the job; the page re-authorises it server-side", () => {
    const s = src("lib/ai/notify.ts");
    expect(s).toContain("/studio/ai/character-replace${q}");
    const result = src("app/api/ai/jobs/[id]/result/route.ts");
    expect(result).toContain("getOwnJob(");
  });

  it("the hand-off route accepts one uuid and reads the outcome from the row", () => {
    const s = src("app/api/internal/ai/notify/route.ts");
    expect(s).toContain("z.object({ jobId: z.string().uuid() }).strict()");
    expect(s).toContain("notifyAiJobFromRow(parsed.data.jobId, { local: true })");
    expect(s).toContain('request.headers.get("x-worker-secret") !== WORKER_SECRET');
  });
});

/* ───────────────────────── attempts (§7) ────────────────────────────────── */

describe("a retry is a new attempt of the same project — never a rewrite", () => {
  const base = {
    clientRequestId: "req_0123456789abcdef",
    photo: { name: "me.jpg", mimeType: "image/jpeg", size: 1000, width: 800, height: 800 },
    video: { name: "clip.mp4", mimeType: "video/mp4", size: 5000, durationMs: 3000, width: 720, height: 1280, hasAudio: true },
  };
  it("the create request may carry the finished attempt it retries, and nothing else new", () => {
    expect(createCharacterReplaceJobSchema.safeParse(base).success).toBe(true);
    expect(createCharacterReplaceJobSchema.safeParse({ ...base, retryOf: "2f7f4a3e-0c3a-4b1e-9d4b-6d5a1c0e9a11" }).success).toBe(true);
    expect(createCharacterReplaceJobSchema.safeParse({ ...base, retryOf: "not-a-uuid" }).success).toBe(false);
    expect(createCharacterReplaceJobSchema.safeParse({ ...base, attempt: 2 }).success).toBe(false);
  });
  it("the route verifies the link is the member's own finished job and numbers the new row", () => {
    const s = src("app/api/ai/character-replace/jobs/route.ts");
    expect(s).toContain("getOwnJob(subject, retryOf)");
    expect(s).toContain('if (isActiveStatus(prior.status)) return fail("JOB_ALREADY_PROCESSING")');
    expect(s).toContain("attempt: lineage?.attempt ?? 1");
    expect(s).toContain("retry_of: lineage?.retryOf ?? null");
  });
  it("the workspace keeps the draft on Try again and links the next start", () => {
    const hook = src("features/ai/character-replace/use-character-replace-workspace.ts");
    expect(hook).toContain("retryOf.current = failedJobId;");
    expect(hook).toContain("...(retryOf.current ? { retryOf: retryOf.current } : {})");
    const shell = src("features/ai/character-replace/character-replace-workspace.tsx");
    expect(shell).toContain("onRetry={retryJob}");
  });
});

/* ───────────────────────── admin (§35–§36) ──────────────────────────────── */

describe("admin recovery — confirmed, reasoned, logged, and only through the live paths", () => {
  const s = src("app/api/admin/ai/character-replace/jobs/[id]/recover/route.ts");
  it("gates on the admin user and records the action before acting", () => {
    expect(s).toContain("await getAdminUser()");
    for (const a of ["retry_finalization", "reconcile", "retry_notification", "refund"]) {
      expect(s).toContain(`"admin.${a}"`);
    }
    const retry = s.slice(s.indexOf('case "retry_finalization"'), s.indexOf('case "reconcile"'));
    expect(retry.indexOf('"admin.retry_finalization"')).toBeLessThan(retry.indexOf("dispatchFinalization(id)"));
    const refund = s.slice(s.indexOf('case "refund"'));
    expect(refund.indexOf('"admin.refund"')).toBeLessThan(refund.indexOf("refundCharacterReplaceCharge("));
  });
  it("refunds only a job that has already failed, and never completes a job by hand", () => {
    expect(s).toContain('job.status === "failed" || job.status === "cancelled" || job.status === "expired"');
    expect(s).not.toContain('"completed"');
  });
  it("the table asks for a reason and a confirmation before posting", () => {
    const ui = src("features/admin/character-replace-job-actions.tsx");
    expect(ui).toContain("window.prompt(");
    expect(ui).toContain("window.confirm(");
    expect(ui).not.toContain("setInterval");
  });
});

describe("summarizeCharacterReplaceJobs", () => {
  const job = (over: Partial<CharacterReplaceAdminJob>): CharacterReplaceAdminJob => ({
    id: "j",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: new Date().toISOString(),
    status: "completed",
    userId: "u",
    quality: "480p",
    durationMs: 3000,
    trimmed: false,
    chargedCents: 30000,
    currency: "NGN",
    refunded: false,
    predictionId: null,
    modelVersion: null,
    errorCode: null,
    failureCategory: null,
    attempt: 1,
    finalizeAttempts: 0,
    finalizeNextAt: null,
    finalizeError: null,
    finalizeMs: null,
    notifiedAt: null,
    notifyPending: false,
    stuck: false,
    ...over,
  });
  it("counts what the operator asked for", () => {
    const sum = summarizeCharacterReplaceJobs([
      job({}),
      job({ status: "failed", refunded: true }),
      job({ status: "processing", completedAt: null }),
      job({ status: "finalizing", completedAt: null, finalizeAttempts: 1, finalizeNextAt: new Date().toISOString() }),
      job({ status: "processing", completedAt: null, stuck: true }),
    ]);
    expect(sum).toMatchObject({ active: 3, processing: 2, finalizing: 1, retrying: 1, stuck: 1, completed24h: 1, failed24h: 1, refunded24h: 1 });
  });
});

/* ───────────────────────── the migration (0156) ─────────────────────────── */

describe("migration 0156 — plain DDL, the audit table locked to the service role", () => {
  const sql = src("supabase/migrations/0156_ai_background_reliability.sql");
  it("has no dollar-quoted block (the partial-apply trap)", () => {
    expect(sql).not.toMatch(/\$\$/);
  });
  it("adds the four columns with separate statements and the recovery index", () => {
    for (const c of ["finalize_attempts", "finalize_lease_until", "finalize_next_at", "finalize_error"]) {
      expect(sql).toContain(`add column if not exists ${c}`);
    }
    expect(sql).toContain("ai_jobs_recovery_idx");
  });
  it("the audit table has RLS on, no member policy, and every grant revoked from the browser roles", () => {
    expect(sql).toContain("alter table public.ai_job_events enable row level security;");
    expect(sql).toContain("revoke all on table public.ai_job_events from anon, authenticated;");
    expect(sql).not.toMatch(/create policy .* on public\.ai_job_events/);
  });
});
