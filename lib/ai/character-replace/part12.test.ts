import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { batchHeadline, summarizeBatch } from "./batch";
import { BATCH_HARD_MAX, createCharacterReplaceBatchSchema, startCharacterReplaceBatchSchema } from "./batch-schema";
import { CHARACTER_REPLACE_DEFAULTS, CHARACTER_REPLACE_PROCESSING_BOUNDS, concurrencyLimitFor, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";
import { finalizeMaxAttempts } from "./finalize-policy";
import { stageName, stageSteps } from "./pipeline";
import type { CharacterAsset, SourceVideo, VideoMetadata } from "./types";
import { processingStatusFor } from "./types";
import { aspectRatioOf, inputReadiness, resolutionLabelOf } from "./validate";
import { INITIAL_STATE, workspaceReducer } from "./workspace";
import { historyChip } from "../history";
import { AI_ACTIVE_STATUSES, AI_JOB_STATUSES, canTransition, isActiveStatus, jobToView, type AiJobRow } from "../jobs";
import { pathState, stageFor } from "../job-stages";
import { AI_STALL_DEADLINE_MS, stallDeadlineMs, stalledForMs } from "../stall";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MULTI-VIDEO SESSIONS (2026-09-21, migration 0166) — pinned where a
 *  regression would be silent: the status, the queue, the caps, the schemas,
 *  the reducer, the money.
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("the `waiting` status is a first-class member of the registry", () => {
  it("is listed, active, and reachable only from a draft; leaves only for the worker or an ending", () => {
    expect(AI_JOB_STATUSES).toContain("waiting");
    expect(AI_ACTIVE_STATUSES).toContain("waiting");
    expect(isActiveStatus("waiting")).toBe(true);
    expect(canTransition("queued", "waiting")).toBe(true);
    expect(canTransition("waiting", "acquiring")).toBe(true);
    expect(canTransition("waiting", "cancelled")).toBe(true);
    expect(canTransition("waiting", "failed")).toBe(true);
    expect(canTransition("waiting", "expired")).toBe(true);
    // a waiting job may NOT skip the worker's preparation
    expect(canTransition("waiting", "processing")).toBe(false);
    expect(canTransition("waiting", "completed")).toBe(false);
    expect(canTransition("processing", "waiting")).toBe(false);
  });
  it("every status-keyed record names it (the build would fail otherwise — pinned so the intent is visible)", () => {
    expect(historyChip({ status: "waiting" } as never, Date.now()).label).toBe("Waiting");
    expect(processingStatusFor("waiting")).toBe("waiting");
    expect(stageName({ status: "waiting", pipeline: null, refund: "none" })).toBe("WAITING");
    expect(stageSteps({ status: "waiting", pipeline: null, mode: "full_character" }).every((s) => s.state === "todo")).toBe(true);
  });
  it("the stage view says what is true: in line, no percentage, still active", () => {
    const view = stageFor({ job: { status: "waiting", createdAt: new Date().toISOString(), startedAt: null } as never });
    expect(view.stage).toBe("waiting");
    expect(view.label).toBe("Waiting in queue");
    expect(view.progress).toBeNull();
    expect(view.active).toBe(true);
    expect(pathState("waiting")).toMatchObject({ uploading: "done", queued: "doing", analyzing: "todo" });
  });
  it("a wait has a ceiling of a day, measured from creation, and the operator's job timeout never drops below the floor", () => {
    expect(AI_STALL_DEADLINE_MS.waiting).toBe(24 * 60 * 60 * 1000);
    const created = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(stalledForMs({ id: "j", status: "waiting", created_at: created, started_at: null })).toBeGreaterThan(0);
    expect(stalledForMs({ id: "j", status: "waiting", created_at: new Date().toISOString(), started_at: null })).toBeNull();
    expect(stallDeadlineMs("processing", { processing: 90 * 60_000 })).toBe(90 * 60_000);
    // 5 minutes is below the 20-minute floor every deadline keeps — ignored, not obeyed
    expect(stallDeadlineMs("processing", { processing: 5 * 60_000 })).toBe(AI_STALL_DEADLINE_MS.processing);
    expect(stallDeadlineMs("processing")).toBe(AI_STALL_DEADLINE_MS.processing);
  });
});

describe("the migration (0166)", () => {
  const sql = src("supabase/migrations/0166_ai_batches_and_queue.sql");
  it("adds the batch columns, the waiting status and the queue's indexes", () => {
    expect(sql).toContain("add column if not exists batch_id uuid");
    expect(sql).toContain("add column if not exists batch_index integer");
    expect(sql).toMatch(/'queued', 'waiting', 'acquiring', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired', 'deleted'/);
    expect(sql).toContain("create index if not exists ai_jobs_batch_idx");
    expect(sql).toContain("create index if not exists ai_jobs_waiting_idx");
    expect(sql).toContain("where status in ('waiting', 'processing', 'finalizing')");
  });
  it("drops the 9-argument claim before creating the 10-argument one (no PostgREST ambiguity), and revokes both functions", () => {
    const drop = sql.indexOf("drop function if exists public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text);");
    const create = sql.indexOf("create or replace function public.claim_ai_job_start(");
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(sql).toContain("p_queue      boolean");
    expect(sql).toContain("create or replace function public.admit_ai_waiting_jobs(");
    for (const fn of ["'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text, boolean)'", "'public.admit_ai_waiting_jobs(uuid, text, integer, integer, integer)'"]) expect(sql).toContain(fn);
    expect(sql).toContain("revoke all on function %s from public, anon, authenticated");
  });
  it("admits only rows whose reservation is confirmed, counts waiting rows against the daily cap, and keeps a member behind their own line", () => {
    expect(sql).toContain("and (metadata -> 'queue' ->> 'reserved_at') is not null");
    expect(sql).toContain("or status = 'waiting')");
    expect(sql).toContain("for update skip locked");
    expect(sql).toMatch(/exists \(select 1 from public\.ai_jobs where user_id = p_user_id and feature = p_feature and status = 'waiting' and id <> p_job_id\)/);
  });
  it("the TypeScript side matches: the claim passes p_queue, falls back to the 0163 claim, and the admission uses the same function name", () => {
    const store = code("lib/ai/job-store.ts");
    expect(store).toContain('rpc("claim_ai_job_start", { ...args, p_queue: input.queue === true })');
    expect(store).toContain('rpc("claim_ai_job_start", args)');
    expect(store).toContain('rpc("admit_ai_waiting_jobs"');
    expect(store).toContain('"claimed" || verdict === "waiting"');
    // a waiting claim whose reservation failed goes back the same way as an acquiring one
    expect(store).toContain('.in("status", ["acquiring", "waiting"])');
    // the pump's admissibility stamp is written only on a still-waiting row
    expect(store).toContain("reserved_at: new Date().toISOString()");
  });
});

describe("the operator's processing settings", () => {
  it("default to the plan caps policy.ts shipped, with the queue on and refunds automatic", () => {
    const d = CHARACTER_REPLACE_DEFAULTS.processing;
    expect(d).toEqual({ queueEnabled: true, concurrency: { free: 1, pro: 2, business: 3, maxAi: 3, admin: 3 }, maxVideosPerBatch: 5, autoRetryCount: 3, jobTimeoutMinutes: 45, refundFailedJobs: true });
  });
  it("clamp every figure to the published bounds and never accept a dangerous value", () => {
    const B = CHARACTER_REPLACE_PROCESSING_BOUNDS;
    const c = normalizeCharacterReplaceConfig({ processing: { concurrency: { free: 999, pro: 0, business: -5, admin: 999 }, maxVideosPerBatch: 1000, autoRetryCount: 50, jobTimeoutMinutes: 1, refundFailedJobs: "yes", queueEnabled: 0 } });
    expect(c.processing.concurrency.free).toBe(B.concurrency.max);
    // the normaliser CLAMPS (0 → the floor of 1), the same way every other integer field here does
    expect(c.processing.concurrency.pro).toBe(B.concurrency.min);
    expect(c.processing.concurrency.business).toBe(B.concurrency.min);
    expect(c.processing.concurrency.admin).toBe(B.adminConcurrency.max);
    expect(c.processing.maxVideosPerBatch).toBe(B.maxVideosPerBatch.max);
    expect(c.processing.autoRetryCount).toBe(B.autoRetryCount.max);
    expect(c.processing.jobTimeoutMinutes).toBe(B.jobTimeoutMinutes.min);
    expect(c.processing.refundFailedJobs).toBe(true);
    expect(c.processing.queueEnabled).toBe(true);
    // the admin route's zod bounds are the same numbers
    const route = src("app/api/admin/landing/route.ts");
    expect(route).toContain("maxVideosPerBatch: z.number().int().min(1).max(20)");
    expect(route).toContain("jobTimeoutMinutes: z.number().int().min(20).max(180)");
    expect(route).toContain("admin: z.number().int().min(1).max(20)");
  });
  it("resolve one member's concurrency the same way for /start, the pump and the balance route", () => {
    const cfg = normalizeCharacterReplaceConfig({ processing: { concurrency: { free: 1, pro: 2, business: 4, maxAi: 5, admin: 8 } } });
    expect(concurrencyLimitFor(cfg, { audience: "free", isAdmin: false, policyMaxConcurrent: 1 })).toBe(1);
    expect(concurrencyLimitFor(cfg, { audience: "pro", isAdmin: false, policyMaxConcurrent: 2 })).toBe(2);
    expect(concurrencyLimitFor(cfg, { audience: "business", isAdmin: false, policyMaxConcurrent: 3 })).toBe(4);
    expect(concurrencyLimitFor(cfg, { audience: "max_ai", isAdmin: false, policyMaxConcurrent: 3 })).toBe(5);
    // an administrator on a free plan gets the administrator's figure
    expect(concurrencyLimitFor(cfg, { audience: "free", isAdmin: true, policyMaxConcurrent: 1 })).toBe(8);
    // the per-member override tightens every plan below it
    const tight = normalizeCharacterReplaceConfig({ limits: { maxActiveJobsPerUser: 2 }, processing: { concurrency: { business: 4, admin: 8 } } });
    expect(concurrencyLimitFor(tight, { audience: "business", isAdmin: false, policyMaxConcurrent: 3 })).toBe(2);
    expect(concurrencyLimitFor(tight, { audience: "free", isAdmin: true, policyMaxConcurrent: 1 })).toBe(2);
    for (const file of ["lib/ai/character-replace/start-job.ts", "lib/ai/character-replace/queue.ts", "app/api/ai/character-replace/balance/route.ts"]) expect(code(file)).toContain("concurrencyLimitFor(");
  });
  it("the retry budget and the public batch facts follow the configuration", () => {
    expect(finalizeMaxAttempts(null)).toBe(3);
    expect(finalizeMaxAttempts({ processing: { autoRetryCount: 5 } })).toBe(5);
    expect(finalizeMaxAttempts({ processing: { autoRetryCount: 99 } })).toBe(3);
    const pub = publicCharacterReplaceConfig(normalizeCharacterReplaceConfig({ processing: { maxVideosPerBatch: 7, queueEnabled: false } }), { code: "USD", symbol: "$" }, true);
    expect(pub.batch).toEqual({ maxVideos: 7, queueEnabled: false });
  });
});

describe("the queue pump and the slot releases", () => {
  it("every undo of a Character Replace job asks for a pump, and the finalizer's completion does too", () => {
    const funding = code("lib/ai/funding.ts");
    expect(funding).toContain('requestQueuePump(opts.job.user_id, `release:${opts.cause ?? "undo"}`)');
    expect(code("server/services/ai-character-replace-finalize-service.ts")).toContain('requestQueuePump(ownerId, "completed")');
    expect(code("lib/ai/recovery.ts")).toContain('pumpCharacterReplaceQueue({ reason: "sweep", now })');
    expect(code("app/api/ai/character-replace/jobs/[id]/start/route.ts")).toContain('requestQueuePump(subject.userId, "start")');
  });
  it("the pump runs on the frontend and the worker asks for it over the internal hop; the switches gate admission", () => {
    const pump = code("lib/ai/character-replace/queue.ts");
    expect(pump).toContain('if (!hasWorker) return { ...result, skipped: "no worker configured on this host" }');
    expect(pump).toContain('if (config.ops.maintenanceMode) return { ...result, skipped: "maintenance" }');
    expect(pump).toContain('if (!config.ops.processingEnabled) return { ...result, skipped: "processing paused" }');
    const signal = code("lib/ai/character-replace/queue-signal.ts");
    expect(signal).toContain("/api/internal/ai/queue");
    expect(signal).toContain("if (!hasWorker) {");
    expect(code("app/api/internal/ai/queue/route.ts")).toContain('request.headers.get("x-worker-secret") !== WORKER_SECRET');
  });
  it("a transient hand-off miss is left for the sweep; only a refused one ends the job", () => {
    const pump = code("lib/ai/character-replace/queue.ts");
    expect(pump).toContain('if (handoff.reason !== "refused") {');
    expect(pump).toContain('prepare_dispatch: "failed"');
    const recovery = code("lib/ai/recovery.ts");
    expect(recovery).toContain('row.status === "acquiring" && retryable && meta.prepare_dispatch === "failed" && !row.replicate_prediction_id');
  });
  it("the failed-job refund switch withholds ONLY on a failure — a cancel and a never-run job always come back", () => {
    const funding = code("lib/ai/funding.ts");
    expect(funding).toContain('if (opts.cause === "failure") {');
    expect(funding).toContain("processing.refundFailedJobs === false");
    expect(funding).toContain('"refund.withheld"');
    // the failure sites say so; the cancel sites say cancel
    for (const f of ["server/services/ai-character-replace-prepare-service.ts", "server/services/ai-character-replace-advance-service.ts", "server/services/ai-character-replace-finalize-service.ts", "lib/ai/stall-server.ts"]) expect(code(f)).toContain('cause: "failure"');
    expect(code("app/api/ai/jobs/[id]/cancel/route.ts")).toContain('cause: "cancel"');
    // 2026-09-21: the webhook sequence is the shared handler (both vendors' routes call it)
    expect(code("lib/ai/webhook-handler.ts")).toContain('await refund(subjectFromRow(job), feature.id, updated, "cancel")');
    expect(code("lib/ai/webhook-handler.ts")).toContain('await refund(subject, feature, updated, "failure")');
  });
  it("the spend sequence lives in one place and both routes call it", () => {
    const core = code("lib/ai/character-replace/start-job.ts");
    // claim BEFORE reserve, waiting stamped AFTER the money moved, no dispatch for a waiting job
    const claim = core.indexOf("await claimJobStart({");
    const reserve = core.indexOf("await reserveCharacterReplaceCharge({");
    const stamp = core.indexOf("await confirmQueueReservation(job.id");
    const dispatch = core.indexOf("await dispatchPreparation(job.id)");
    expect(claim).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(claim);
    expect(stamp).toBeGreaterThan(reserve);
    expect(dispatch).toBeGreaterThan(stamp);
    expect(code("app/api/ai/character-replace/jobs/[id]/start/route.ts")).toContain("startCharacterReplaceJob({");
    expect(code("app/api/ai/character-replace/batches/[id]/start/route.ts")).toContain("startCharacterReplaceJob({");
    expect(code("app/api/ai/character-replace/batches/[id]/start/route.ts")).toContain("queue: true");
  });
});

describe("the batch schemas", () => {
  const video = { name: "a.mp4", mimeType: "video/mp4", size: 1000, durationMs: 5000, width: 1080, height: 1920, hasAudio: true };
  const photo = { name: "p.jpg", mimeType: "image/jpeg", size: 1000, width: 1080, height: 1920 };
  const quote = { id: "q".repeat(20), product: "character_replace" as const, currency: "USD", pricingConfigVersion: 1, durationMs: 5000, quality: "480p", voiceMode: "original" as const, lipSyncMode: null, totalCents: 100, expiresAt: new Date().toISOString() };
  it("create: one photo, many videos, bounded, strict", () => {
    expect(createCharacterReplaceBatchSchema.safeParse({ batchRequestId: "abcdefgh1234", photo, videos: [video, video] }).success).toBe(true);
    expect(createCharacterReplaceBatchSchema.safeParse({ batchRequestId: "abcdefgh1234", photo, videos: [] }).success).toBe(false);
    expect(createCharacterReplaceBatchSchema.safeParse({ batchRequestId: "abcdefgh1234", photo, videos: Array(BATCH_HARD_MAX + 1).fill(video) }).success).toBe(false);
    expect(createCharacterReplaceBatchSchema.safeParse({ batchRequestId: "abcdefgh1234", photo, videos: [video], price: 1 }).success).toBe(false);
  });
  it("start: a quote and a token per job, consent literal, no trim field at all", () => {
    expect(startCharacterReplaceBatchSchema.safeParse({ consent: true, jobs: [{ jobId: "11111111-1111-4111-8111-111111111111", quote, preflightToken: "t".repeat(20) }] }).success).toBe(true);
    expect(startCharacterReplaceBatchSchema.safeParse({ consent: false, jobs: [{ jobId: "11111111-1111-4111-8111-111111111111", quote }] }).success).toBe(false);
    expect(startCharacterReplaceBatchSchema.safeParse({ consent: true, jobs: [{ jobId: "11111111-1111-4111-8111-111111111111", quote, trim: { startMs: 0, endMs: 100 } }] }).success).toBe(false);
    expect(startCharacterReplaceBatchSchema.safeParse({ consent: true, jobs: [{ jobId: "not-a-uuid", quote }] }).success).toBe(false);
  });
  it("the start route refuses a job id that is not in the batch, and pre-checks the paid total", () => {
    const route = code("app/api/ai/character-replace/batches/[id]/start/route.ts");
    expect(route).toContain('for (const j of parsed.data.jobs) if (!byId.has(j.jobId)) return fail("JOB_NOT_FOUND");');
    expect(route).toContain('return fail("CR_BALANCE_REQUIRED"');
    expect(route).toContain('if (!config.processing.queueEnabled && parsed.data.jobs.length > 1) return fail("CR_QUEUE_OFF")');
  });
  it("the create route keeps its own batch's drafts and enforces the open-jobs ceiling", () => {
    const route = code("app/api/ai/character-replace/batches/route.ts");
    expect(route).toContain("supersedeOwnDrafts(ownerId, feature.id, new Date(), { keepBatchId: batchId })");
    expect(route).toContain('return fail("CR_QUEUE_FULL"');
    expect(route).toContain('return fail("CR_BATCH_TOO_LARGE"');
    expect(route).toContain("clientRequestId: `${batchRequestId}:${i + 1}`");
  });
});

describe("the batch summary", () => {
  it("counts by what the member sees, and the headline reads naturally", () => {
    const s = summarizeBatch("b", [{ status: "processing" }, { status: "acquiring" }, { status: "waiting" }, { status: "completed" }, { status: "failed" }, { status: "cancelled" }]);
    expect(s.counts).toEqual({ waiting: 1, processing: 2, completed: 1, failed: 1, cancelled: 1, drafts: 0 });
    expect(s.active).toBe(true);
    expect(batchHeadline(s)).toBe("6 videos · 2 processing · 1 waiting · 1 done · 1 didn't finish · 1 cancelled");
    expect(summarizeBatch("b", [{ status: "completed" }]).active).toBe(false);
  });
  it("the view carries the batch identity, never a path", () => {
    const row = { id: "j", user_id: "u", guest_id: null, batch_id: "b", batch_index: 2, feature: "ai_character_replace", provider: "replicate", model: null, model_version: null, status: "waiting", client_request_id: null, source_path: "u/x/j/source.mp4", result_path: null, poster_path: null, funding_source: "balance", charged_cents: 100, source_size: 1, result_size: null, result_duration: null, result_mime_type: null, audio_restored: null, source_duration: 5, source_mime_type: "video/mp4", source_kind: "upload", source_url: null, replicate_prediction_id: null, error_code: null, error_message: null, created_at: new Date().toISOString(), started_at: null, completed_at: null, expires_at: null, notified_at: null, finalize_attempts: 0, finalize_lease_until: null, finalize_next_at: null, finalize_error: null, metadata: { tool: "character_replace", batch: { id: "b", index: 2, size: 4 } } } as AiJobRow;
    const view = jobToView(row, () => "");
    expect(view.batch).toEqual({ id: "b", index: 2, size: 4 });
    expect(JSON.stringify(view)).not.toContain("source.mp4");
  });
});

describe("the reducer: several videos", () => {
  const config = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, false);
  const photo = (): CharacterAsset => ({ file: new File(["x"], "me.jpg", { type: "image/jpeg" }), objectUrl: "blob:p", width: 1080, height: 1920, size: 1, mimeType: "image/jpeg", name: "me.jpg" });
  const meta = (durationMs: number | null): VideoMetadata => ({ durationMs, width: 1080, height: 1920, aspect: aspectRatioOf(1080, 1920), resolutionLabel: resolutionLabelOf(1080, 1920), sizeBytes: 1, mimeType: "video/mp4", container: "mp4", frameRate: null, videoCodec: null, hasAudio: null, audioDurationMs: null });
  const video = (name: string, durationMs = 8_000, size = 1): SourceVideo => ({ file: new File(["x"], name, { type: "video/mp4" }), objectUrl: `blob:${name}`, name, size, mimeType: "video/mp4", metadata: meta(durationMs) });
  const withPhoto = () => workspaceReducer(INITIAL_STATE, { type: "photo/ready", asset: photo() });

  it("adds beside the first, de-duplicates, drops the trim, and removes one at a time", () => {
    let s = workspaceReducer(withPhoto(), { type: "video/ready", video: video("a.mp4", 200_000), maxDurationMs: 120_000 });
    expect(s.project.settings.trim).not.toBeNull();
    s = workspaceReducer(s, { type: "videos/add", videos: [video("b.mp4"), video("c.mp4"), video("b.mp4")] });
    expect(s.project.video?.name).toBe("a.mp4");
    expect(s.project.extraVideos.map((v) => v.name)).toEqual(["b.mp4", "c.mp4"]);
    // a batch has no trim
    expect(s.project.settings.trim).toBeNull();
    expect(workspaceReducer(s, { type: "trim", start: 0, end: 3 }).project.settings.trim).toBeNull();
    s = workspaceReducer(s, { type: "videos/remove", index: 0 });
    expect(s.project.extraVideos.map((v) => v.name)).toEqual(["c.mp4"]);
    // removing the first promotes the next
    s = workspaceReducer(s, { type: "video/clear" });
    expect(s.project.video?.name).toBe("c.mp4");
    expect(s.project.extraVideos).toEqual([]);
    expect(workspaceReducer(s, { type: "videos/clear" }).project.video).toBeNull();
  });
  it("with no first video, the first added becomes it", () => {
    const s = workspaceReducer(withPhoto(), { type: "videos/add", videos: [video("a.mp4"), video("b.mp4")] });
    expect(s.project.video?.name).toBe("a.mp4");
    expect(s.project.extraVideos.map((v) => v.name)).toEqual(["b.mp4"]);
    expect(s.video.status).toBe("ready");
  });
  it("readiness refuses an extra video longer than the ceiling (no trim to save it) and accepts fitting ones", () => {
    const s = workspaceReducer(workspaceReducer(withPhoto(), { type: "video/ready", video: video("a.mp4"), maxDurationMs: 120_000 }), { type: "videos/add", videos: [video("b.mp4", 500_000)] });
    expect(inputReadiness(s.project, config).issues).toContain("extra-video-too-long");
    const ok = workspaceReducer(workspaceReducer(withPhoto(), { type: "video/ready", video: video("a.mp4"), maxDurationMs: 120_000 }), { type: "videos/add", videos: [video("b.mp4", 9_000)] });
    expect(inputReadiness(ok.project, config).ready).toBe(true);
  });
  it("a reset clears the session too", () => {
    const s = workspaceReducer(workspaceReducer(withPhoto(), { type: "videos/add", videos: [video("a.mp4"), video("b.mp4")] }), { type: "reset/keep-photo" });
    expect(s.project.extraVideos).toEqual([]);
    expect(s.project.video).toBeNull();
    expect(s.project.character).not.toBeNull();
  });
});

describe("the interface tells the truth", () => {
  it("the board draws no percentage for a server-side phase, and every card state has words", () => {
    const board = src("features/ai/character-replace/batch-board.tsx");
    expect(board).not.toMatch(/Math\.round\([^)]*progress[^)]*\* 100\)/);
    for (const label of ['"Waiting in queue"', '"Preparing"', '"Processing"', '"Finishing"', '"Ready"', "\"Didn't finish\"", '"Cancelled"']) expect(board).toContain(label);
    expect(board).toContain("Download all");
    expect(board).toContain("Remove from queue");
  });
  it("the launch shows the upload's measured bytes and nothing else as a number", () => {
    const panel = src("features/ai/character-replace/batch-launch-panel.tsx");
    expect(panel).toContain("Math.round(item.uploadProgress * 100)");
    expect(panel).toContain("Process {items.length} videos");
  });
  it("the workspace opens the board for ?batch=, offers the session still in flight, and routes N videos through the batch launch", () => {
    const ws = code("features/ai/character-replace/character-replace-workspace.tsx");
    expect(ws).toContain('params.get("batch")');
    expect(ws).toContain("getActiveCharacterReplaceBatch()");
    expect(ws).toContain("if (batch.isBatch) {");
    expect(ws).toContain("await batch.startBatch();");
    expect(ws).toContain("<CharacterReplaceBatchBoard");
  });
  it("the video step takes several files only when the operator's queue is on", () => {
    const hook = code("features/ai/character-replace/use-character-replace-batch.ts");
    expect(hook).toContain("const multiAllowed = queueEnabled && maxVideos > 1;");
    expect(code("features/ai/character-replace/media-picker.tsx")).toContain("multiple={multiple}");
  });
});
