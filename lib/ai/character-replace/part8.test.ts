import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { advance, markSubmitted, markSucceeded, planPipeline } from "./pipeline";

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
