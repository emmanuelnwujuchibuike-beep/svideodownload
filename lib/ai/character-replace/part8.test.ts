import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_ERRORS, AiJobError } from "@/lib/ai/errors";
import { countsAsProviderFailure, isCircuitOpen } from "./circuit";
import { CHARACTER_REPLACE_DEFAULTS, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";
import { advance, markSubmitted, markSucceeded, planPipeline } from "./pipeline";
import { inputReadiness, qualityOffered } from "./validate";
import { INITIAL_STATE, workspaceReducer } from "./workspace";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The source with its comments removed — so a sentence ABOUT a thing cannot pass a test about doing it. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 8 — production hardening, pinned from what production showed
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("a scheduled retry is a hand-off, never a decline (production, 2026-09-14)", () => {
  /*
    The first voice + lip-sync job on production died at the replace stage:
    Replicate throttled the submit (429, a low-credit account gets one
    prediction a minute), the worker correctly left the job for the sweep —
    and answered `ok: false`, which the dispatcher read as "the worker
    declined" and the webhook turned into FINALIZER_UNAVAILABLE + a refund.
  */
  it("the worker says `retry: true` on both retry branches and both routes pass it through", () => {
    const adv = code("server/services/ai-character-replace-advance-service.ts");
    expect(adv).toContain("return { ok: false, jobId, retry: true, code: failure.code, detail: `retry left to the sweep: ${failure.detail}` };");
    const fin = code("server/services/ai-character-replace-finalize-service.ts");
    expect(fin).toContain("return { ok: false, jobId, retry: true, code: failure.code, detail: `retry scheduled: ${failure.detail}` };");
    for (const route of ["app/api/internal/ai/advance/route.ts", "app/api/internal/ai/finalize/route.ts"]) {
      expect(code(route)).toContain('retry: "retry" in outcome && outcome.retry === true,');
    }
  });
  it("the dispatcher treats `ok:false + retry:true` as dispatched, before the decline branch", () => {
    const d = code("lib/ai/finalize-dispatch.ts");
    const retry = d.indexOf("if (body && body.ok === false && body.retry === true) return { dispatched: true, retry: true };");
    const decline = d.indexOf("if (body && body.ok === false) {");
    expect(retry).toBeGreaterThan(0);
    expect(decline).toBeGreaterThan(retry);
  });
});

describe("the reconciler is stage-aware (Part 8)", () => {
  it("acts only on the CURRENT stage's in-flight prediction, and advances an intermediate stage instead of finalizing it", () => {
    const r = code("lib/ai/reconcile.ts");
    // the guard runs BEFORE the provider is asked
    const guard = r.indexOf("if (!inFlight || (record.predictionId && record.predictionId !== job.replicate_prediction_id)) return false;");
    const poll = r.indexOf("const state = await provider.poll(job.replicate_prediction_id);");
    expect(guard).toBeGreaterThan(0);
    expect(poll).toBeGreaterThan(guard);
    // an intermediate stage goes to the advance, never the finalizer
    const intermediate = r.indexOf("if (intermediate) {");
    const adv = r.indexOf("const dispatch = await dispatchAdvance(job.id);", intermediate);
    const fin = r.indexOf("const dispatch = await dispatchFinalization(job.id);");
    expect(intermediate).toBeGreaterThan(0);
    expect(adv).toBeGreaterThan(intermediate);
    expect(fin).toBeGreaterThan(adv);
    // a failed stage names itself
    expect(r).toContain('stage === "voice" ? "VOICE_GENERATION_FAILED" : stage === "lipsync" ? "LIPSYNC_FAILED" : "PROCESSING_FAILED"');
    // the member's sentence is the product's, not AI Clean's
    expect(r).toContain('job.feature === "ai_character_replace" ? aiErrorMessage("PROCESSING_FAILED")');
  });

  it("advance() stamps the stage clock, so a throttled submit is retried after ITS minute, not the previous stage's", () => {
    const p = planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "studio" });
    const submitted = markSubmitted(p, "voice", { predictionId: "pred-voice", provider: { id: "replicate", model: "m", version: null }, at: "2026-09-14T10:00:00.000Z" });
    expect(submitted.stage_started_at).toBe("2026-09-14T10:00:00.000Z");
    const done = markSucceeded(submitted, "voice", "https://replicate.delivery/a.wav", "2026-09-14T10:00:15.000Z");
    const moved = advance(done, "voice", "replace", "u/f/j/voice-prepared.wav", "2026-09-14T10:00:20.000Z")!;
    expect(moved.current).toBe("replace");
    expect(moved.stage_started_at).toBe("2026-09-14T10:00:20.000Z");
    expect(moved.records.voice?.storedPath).toBe("u/f/j/voice-prepared.wav");
    const rec = src("lib/ai/recovery.ts");
    expect(rec).toContain("const STAGE_SUBMIT_GRACE_MS = 70_000;");
    expect(rec).toContain("if (Number.isFinite(stageStarted) && now - stageStarted < STAGE_SUBMIT_GRACE_MS) return \"working\";");
  });
});

describe("gone is 404 (Part 7 §20, measured on the production E2E)", () => {
  it("the result route answers not-found for a deleted job, before the readiness check", () => {
    const r = code("app/api/ai/jobs/[id]/result/route.ts");
    const deleted = r.indexOf('if (job.status === "deleted") {');
    const notReady = r.indexOf('if (job.status !== "completed" || !job.result_path) {');
    expect(deleted).toBeGreaterThan(0);
    expect(notReady).toBeGreaterThan(deleted);
  });
});

describe("the AI button (owner, 2026-09-14, twice)", () => {
  it("lives on /history only — no layout mounts it, and the allow-list has one entry", () => {
    expect(src("features/ai/frenz-ai-fab.tsx")).toContain('const SHOWN_PREFIXES = ["/history"];');
    expect(src("app/(app)/layout.tsx")).not.toContain("FrenzAiFab");
    expect(src("app/u/layout.tsx")).not.toContain("FrenzAiFab");
    expect(src("app/(marketing)/history/page.tsx")).toContain("<FrenzAiFab />");
  });
});

/* ═══════════════════════ the switches, the limits, the breaker ═══════════════════════ */

describe("the kill switches and the limits are configuration (§2, §4, §8)", () => {
  it("defaults: processing on, no maintenance, breaker 5 in 10 min → 5 min pause, 25 active platform-wide, no per-member caps", () => {
    expect(CHARACTER_REPLACE_DEFAULTS.ops).toEqual({
      processingEnabled: true,
      maintenanceMode: false,
      maintenanceMessage: expect.stringContaining("Character Replace is being looked after"),
      launchMode: "production",
      circuitBreaker: { enabled: true, failureThreshold: 5, windowSeconds: 600, cooldownSeconds: 300 },
    });
    expect(CHARACTER_REPLACE_DEFAULTS.limits).toEqual({ maxActiveJobsPerUser: 0, maxActiveJobsGlobal: 25, maxJobsPerUserPerDay: 0 });
    expect(CHARACTER_REPLACE_DEFAULTS.localMinorUnitsPerUsd).toBe(0);
  });
  it("clamps and defaults every field; a blank maintenance message keeps the default sentence", () => {
    const c = normalizeCharacterReplaceConfig({
      ops: { processingEnabled: false, maintenanceMode: true, maintenanceMessage: "   ", circuitBreaker: { failureThreshold: 0, windowSeconds: 1, cooldownSeconds: 999_999 } },
      limits: { maxActiveJobsPerUser: 500, maxActiveJobsGlobal: -3, maxJobsPerUserPerDay: 7.9 },
      localMinorUnitsPerUsd: 150_000,
    });
    expect(c.ops.processingEnabled).toBe(false);
    expect(c.ops.maintenanceMode).toBe(true);
    expect(c.ops.maintenanceMessage).toBe(CHARACTER_REPLACE_DEFAULTS.ops.maintenanceMessage);
    expect(c.ops.circuitBreaker).toEqual({ enabled: true, failureThreshold: 1, windowSeconds: 30, cooldownSeconds: 86_400 });
    expect(c.limits).toEqual({ maxActiveJobsPerUser: 100, maxActiveJobsGlobal: 0, maxJobsPerUserPerDay: 7 });
    expect(c.localMinorUnitsPerUsd).toBe(150_000);
  });
  it("none of it reaches a browser through the public config", () => {
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, true);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/circuitBreaker|maxActiveJobsGlobal|localMinorUnitsPerUsd|failureThreshold|maintenanceMessage/);
  });
  it("every refusal has its own code, an honest status and the words 'nothing was charged'", () => {
    expect(AI_ERRORS.CR_ACTIVE_LIMIT.status).toBe(409);
    expect(AI_ERRORS.CR_DAILY_LIMIT.status).toBe(429);
    expect(AI_ERRORS.CR_BUSY.status).toBe(503);
    expect(AI_ERRORS.CR_MAINTENANCE.status).toBe(503);
    for (const c of ["CR_ACTIVE_LIMIT", "CR_DAILY_LIMIT", "CR_BUSY"] as const) expect(AI_ERRORS[c].message).toMatch(/nothing was charged/);
  });
});

describe("/start: switches → breaker → claim (limits, one lock) → reserve → revert on a failed reserve (§4, §5, §7)", () => {
  const start = code("app/api/ai/character-replace/jobs/[id]/start/route.ts");
  it("the order of the gates is the order money is protected in", () => {
    const at = (needle: string) => {
      const i = start.indexOf(needle);
      expect(i, needle).toBeGreaterThan(0);
      return i;
    };
    const maintenance = at('if (config.ops.maintenanceMode) return fail("CR_MAINTENANCE", { error: config.ops.maintenanceMessage });');
    const paused = at('if (!config.ops.processingEnabled) return fail("CR_BUSY");');
    const breaker = at("const { open } = await providerHealthFor(models);");
    const claim = at("const claim = await claimJobStart({");
    const reserve = at("balanceAfter = await reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot });");
    // Part 11 added a revert on a refused FREE use before the reserve; the one this test pins is the reserve's own
    const revert = start.indexOf("const reverted = await revertJobStartClaim(job.id, job.metadata ?? {});", reserve);
    expect(revert).toBeGreaterThan(0);
    const handoff = at("const handoff = await dispatchPreparation(job.id);");
    expect(maintenance).toBeLessThan(paused);
    expect(paused).toBeLessThan(breaker);
    expect(breaker).toBeLessThan(claim);
    expect(claim).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(revert);
    expect(revert).toBeLessThan(handoff);
    // the old order is gone: no reservation before the claim
    expect(start.slice(0, claim)).not.toContain("reserveCharacterReplaceCharge(");
    // every limit verdict answers its own code
    expect(start).toContain('if (claim === "user_limit") return fail("CR_ACTIVE_LIMIT");');
    expect(start).toContain('if (claim === "daily_limit") return fail("CR_DAILY_LIMIT");');
    expect(start).toContain('return fail("CR_BUSY");');
  });
  it("the claim is one SQL function under an advisory lock, revoked from the browser roles", () => {
    const sql = src("supabase/migrations/0158_ai_hardening.sql");
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));");
    expect(sql).toContain("where id = p_job_id and user_id = p_user_id and status = 'queued';");
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql).toContain("'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb)'");
    expect(sql).toContain("'public.ai_provider_health_record(text, boolean, integer, integer, integer, text)'");
    expect(sql).toContain("revoke all on table public.ai_provider_health from anon, authenticated;");
    // the revokes are the last statement, inside one do-block (the 0130 lesson)
    expect(sql.trim().endsWith("end $$;")).toBe(true);
  });
  it("the store falls back to the plain CAS only when the function is missing, and the revert is guarded on acquiring + no prediction", () => {
    const store = code("lib/ai/job-store.ts");
    expect(store).toContain('if (error.code === "PGRST202" || error.code === "PGRST203" || /claim_ai_job_start/.test(error.message)) {');
    expect(store).toContain('.eq("status", "acquiring")\n    .is("replicate_prediction_id", null)');
  });
  it("creation refuses on the switches too, and the config route folds them into processingAvailable", () => {
    const create = code("app/api/ai/character-replace/jobs/route.ts");
    expect(create).toContain('if (config.ops.maintenanceMode) return fail("CR_MAINTENANCE", { error: config.ops.maintenanceMessage });');
    expect(create).toContain('if (!config.ops.processingEnabled) return fail("CR_BUSY");');
    const cfg = code("app/api/ai/character-replace/config/route.ts");
    expect(cfg).toContain("processingAvailable: hasProviderFor(feature) && hasWorker && cr.ops.processingEnabled && !cr.ops.maintenanceMode,");
  });
});

describe("the circuit breaker (§7)", () => {
  it("open = opened_until in the future; a past window is closed", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    expect(isCircuitOpen(null, now)).toBe(false);
    expect(isCircuitOpen({ openedUntil: null }, now)).toBe(false);
    expect(isCircuitOpen({ openedUntil: "2026-09-14T12:04:59Z" }, now)).toBe(true);
    expect(isCircuitOpen({ openedUntil: "2026-09-14T11:59:59Z" }, now)).toBe(false);
    expect(isCircuitOpen({ openedUntil: "not a date" }, now)).toBe(false);
  });
  it("scores a throttle, an out-of-credit answer, a 5xx and a network failure — never a member's input", () => {
    expect(countsAsProviderFailure(new AiJobError("PROVIDER_UNAVAILABLE", "429"))).toBe(true);
    expect(countsAsProviderFailure(new AiJobError("PROVIDER_ERROR", "502"))).toBe(true);
    expect(countsAsProviderFailure(new TypeError("fetch failed"))).toBe(true);
    expect(countsAsProviderFailure(new AiJobError("INVALID_INPUT", "language not spoken"))).toBe(false);
    expect(countsAsProviderFailure(new AiJobError("FEATURE_UNAVAILABLE", "not configured"))).toBe(false);
    expect(countsAsProviderFailure("string")).toBe(false);
  });
  it("every provider submit runs under it, and the refusal is the transient code every caller already retries", () => {
    const submit = code("lib/ai/character-replace/submit.ts");
    expect(submit.match(/withCircuit\(provider\.model, config\.ops\.circuitBreaker, \(\) =>/g)?.length).toBe(3);
    expect(submit).not.toMatch(/await provider\.createPrediction\(/);
    const circuit = code("lib/ai/character-replace/circuit.ts");
    expect(circuit).toContain('throw new AiJobError("PROVIDER_UNAVAILABLE", `circuit open for ${key} until ${open[0]!.openedUntil}`);');
  });
});

describe("the Continue gate reads the mode's own tiers (owner, 2026-09-14)", () => {
  const config = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, true);
  it("Face Only 'standard' is offered; 'ultra' is not; Full Character reads 480p/720p/1080p", () => {
    expect(qualityOffered(config, "face_only", "standard")).toBe(true);
    expect(qualityOffered(config, "face_only", "ultra")).toBe(false);
    expect(qualityOffered(config, "full_character", "720p")).toBe(true);
    expect(qualityOffered(config, "full_character", "standard")).toBe(false);
  });
  it("a Face Only project is not refused for its quality — the summary no longer says 'check the selected range'", () => {
    const face = workspaceReducer(INITIAL_STATE, { type: "mode", mode: "face_only", defaultQuality: "standard", maxReferences: 1 });
    const issues = inputReadiness(face.project, config).issues;
    expect(issues).not.toContain("quality-unavailable");
  });
});

describe("the doors open instantly or say they are opening (owner, 2026-09-14)", () => {
  it("Start Creating, the tool cards and the crumb prefetch by default and carry the pending stripe", () => {
    const entry = src("features/ai/character-replace/character-replace-entry.tsx");
    expect(entry).not.toContain("prefetch={false}");
    expect(entry).toContain("<LinkPendingStripe />");
    const grid = src("features/ai/frenz-ai-tool-grid.tsx");
    expect(grid).not.toContain("prefetch={false}");
    expect(grid).toContain("<LinkPendingStripe />");
    expect(src("features/ai/frenz-ai-chrome.tsx")).not.toContain("prefetch={false}");
    const stripe = src("features/navigation/link-pending-stripe.tsx");
    expect(stripe).toContain("useLinkStatus");
    expect(stripe).toContain("createPortal(");
    expect(stripe).not.toMatch(/useRouter|usePathname|router\.(push|prefetch)/);
    expect(src("features/app-shell/mobile-nav.tsx")).toContain('"/history", "/studio/ai/history"');
  });
});
