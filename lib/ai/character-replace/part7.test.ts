import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_ACTIVE_STATUSES, AI_JOB_STATUSES, canTransition, jobToView, type AiJobRow } from "@/lib/ai/jobs";
import { historyChip, statusesForFilter } from "@/lib/ai/history";
import { CHARACTER_REPLACE_DEFAULTS, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";
import { stageName } from "./pipeline";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The source with its comments removed — so a sentence ABOUT the ledger cannot fail a test about touching it. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 — the result experience: ownership, deletion, retention, history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §35's security audit, as far as it is pure or provable from the source:
 * every door checks ownership through `getOwnJob` (the member's own client +
 * an explicit user filter) and answers "not found" to a stranger; deletion
 * clears the files and never the ledger; deleted rows leave history; the
 * notification carries an id and nothing else; downloads and previews go
 * through short signed URLs.
 */

const row = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "u1",
  guest_id: null,
  feature: "ai_character_replace",
  provider: "replicate",
  model: "wan-video/wan-2.2-animate-replace",
  model_version: "hidden",
  status: "completed",
  client_request_id: "r",
  source_path: "u1/aicharacterreplace/1111/source.mp4",
  result_path: "u1/aicharacterreplace/1111/result.mp4",
  poster_path: "u1/aicharacterreplace/1111/poster.jpg",
  funding_source: "balance",
  charged_cents: 31_000,
  source_size: 1,
  result_size: 2,
  result_duration: 12.4,
  result_mime_type: "video/mp4",
  audio_restored: true,
  source_duration: 12.4,
  source_mime_type: "video/mp4",
  source_kind: "upload",
  source_url: null,
  replicate_prediction_id: "p",
  error_code: null,
  error_message: null,
  created_at: "2026-09-14T10:00:00Z",
  started_at: "2026-09-14T10:00:10Z",
  completed_at: "2026-09-14T10:05:00Z",
  expires_at: "2026-09-17T10:05:00Z",
  notified_at: null,
  finalize_attempts: 1,
  finalize_lease_until: null,
  finalize_next_at: null,
  finalize_error: null,
  metadata: {
    tool: "character_replace",
    attempt: 1,
    mode: "face_only",
    settings: { quality: "standard", voiceMode: "new_voice", lipSyncMode: "studio" },
    audio: { source: "tts", tts: { languageCode: "es", voiceId: "es-serene" } },
    quote: { durationMs: 12_400, currency: "NGN", qualityRateCents: 1_500 },
    prepared: { durationMs: 12_400, trimmed: true },
    output: { width: 720, height: 1280, frameRate: 30, durationMs: 12_400 },
    saved_at: "2026-09-14T11:00:00Z",
    ...(over.metadata ?? {}),
  },
  ...over,
});

describe("the deleted status (§20, migration 0157)", () => {
  it("is terminal, reachable only from a finished job, and leaves every history tab", () => {
    expect(AI_JOB_STATUSES).toContain("deleted");
    expect(AI_ACTIVE_STATUSES).not.toContain("deleted");
    for (const from of ["completed", "failed", "cancelled", "expired"] as const) expect(canTransition(from, "deleted")).toBe(true);
    for (const from of ["queued", "acquiring", "processing", "finalizing"] as const) expect(canTransition(from, "deleted")).toBe(false);
    expect(canTransition("deleted", "expired")).toBe(false);
    expect(statusesForFilter("completed")).not.toContain("deleted");
    expect(statusesForFilter("cancelled")).not.toContain("deleted");
    // the "all" tab is unfiltered on the client — the STORE leaves deleted rows out by name
    const store = src("lib/ai/job-store.ts");
    expect(store).toContain('else query = query.neq("status", "deleted");');
    const sql = src("supabase/migrations/0157_ai_jobs_deleted.sql");
    expect(sql).toMatch(/'expired', 'deleted'/);
    expect(historyChip(jobToView(row({ status: "deleted" }), () => ""), Date.now()).label).toBe("Deleted");
    expect(stageName({ status: "deleted", pipeline: null, refund: "none" })).toBe("CANCELLED");
  });

  it("the delete route is owner-only, terminal-only, clears files and paths, and never touches the ledger", () => {
    const route = src("app/api/ai/jobs/[id]/route.ts");
    expect(route).toContain("export async function DELETE(");
    expect(route).toContain("const row = await getOwnJob(subject, id);");
    expect(route).toContain('if (isActiveStatus(row.status)) return NextResponse.json(aiErrorBody("JOB_ALREADY_PROCESSING"');
    expect(code("app/api/ai/jobs/[id]/route.ts")).not.toMatch(/refundCharacterReplaceCharge|releaseJobFunding|ai_product_ledger|creditCharacterReplaceBalance/);
    const retention = src("lib/ai/retention.ts");
    expect(retention).toContain("export async function deleteAiJobResult(");
    expect(retention).toContain('status: "deleted"');
    expect(retention).toContain("source_path: null,\n      result_path: null,\n      poster_path: null,");
    expect(retention).toContain('.in("status", ["completed", "failed", "cancelled", "expired"])');
    expect(code("lib/ai/retention.ts")).not.toMatch(/ai_product_ledger|refund_product_charge/);
  });
});

describe("the result route and the deep link (§19, §23–§24)", () => {
  it("checks ownership on the server and answers notFound() for a stranger's or a missing id", () => {
    const page = src("app/(app)/studio/ai/character-replace/result/[id]/page.tsx");
    expect(page).toContain("const job = await getOwnJob(userSubject(user.id), id);");
    expect(page).toContain('if (!job || job.feature !== "ai_character_replace") notFound();');
    expect(page).toContain("if (!user) redirect(`/login?next=${encodeURIComponent(`/studio/ai/character-replace/result/${id}`)}`);");
    expect(page).toContain("robots: { index: false, follow: false, nocache: true }");
  });
  it("the push opens the result route with the job id only — no media URL, no provider URL", () => {
    const notify = src("lib/ai/notify.ts");
    expect(notify).toContain("/studio/ai/character-replace/result/${encodeURIComponent(jobId)}");
    expect(notify).not.toMatch(/replicate\.delivery|signSourceUrl|signResultUrl/);
  });
  it("history opens Character Replace rows through the result route, every status", () => {
    const history = src("features/ai/frenz-ai-history.tsx");
    expect(history).toContain('if (job.feature === "ai_character_replace") {\n      router.push(resultHref(job.id));');
    expect(history).toContain('const opens = playable || job.feature === "ai_character_replace";');
    expect(history).toContain('cr?.refunded ? " · Refunded ✓"');
  });
  it("the comparison source is the prepared cut, signed for ten minutes, owner-checked", () => {
    const source = src("app/api/ai/jobs/[id]/source/route.ts");
    expect(source).toContain("readCharacterReplaceMeta(job.metadata)?.prepared?.path");
    expect(source).toContain("pathBelongsTo(sourcePath, subjectOwnerId(subject), job.id)");
    expect(src("lib/ai/storage.ts")).toContain("export const AI_SIGNED_URL_TTL_SECONDS = 600;");
  });
});

describe("the view (§6, §12) and the save (§9)", () => {
  it("carries the output's own facts, the saved mark and the voice's language — never a path, a URL or the dialogue", () => {
    const v = jobToView(row(), () => "")!;
    expect(v.characterReplace).toMatchObject({ mode: "face_only", savedAt: "2026-09-14T11:00:00Z", output: { width: 720, height: 1280, frameRate: 30 }, languageCode: "es", voiceId: "es-serene", voiceApplied: true, rateCents: 1_500 });
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/aicharacterreplace\/|replicate|prediction|\/result\.mp4|"text"/);
    const original = jobToView(row({ metadata: { tool: "character_replace", attempt: 1, settings: { quality: "720p", voiceMode: "original", lipSyncMode: null } } }), () => "")!;
    expect(original.characterReplace).toMatchObject({ mode: "full_character", savedAt: null, output: null, languageCode: null, voiceId: null, voiceSource: null });
  });
  it("the save route is owner-only and moves only the expiry and a mark — no copy, no charge", () => {
    const save = src("app/api/ai/jobs/[id]/save/route.ts");
    expect(save).toContain("const job = await getOwnJob(subject, id);");
    expect(save).toContain('if (!job || job.status !== "completed" || !job.result_path) return fail("JOB_NOT_FOUND");');
    expect(save).toContain("savedResultDays * 86_400_000");
    expect(code("app/api/ai/jobs/[id]/save/route.ts")).not.toMatch(/\.upload\(|\.copy\(|reserveCharacterReplaceCharge|reserve_product_charge/);
  });
  it("retention is configuration-driven and clamped (§21)", () => {
    expect(CHARACTER_REPLACE_DEFAULTS.retention).toEqual({ resultHours: 72, savedResultDays: 30 });
    const c = normalizeCharacterReplaceConfig({ retention: { resultHours: 9_999, savedResultDays: 0 } });
    expect(c.retention).toEqual({ resultHours: 720, savedResultDays: 1 });
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, true);
    expect(pub.retention).toEqual({ resultHours: 72, savedResultDays: 30 });
    expect(src("app/api/ai/character-replace/jobs/route.ts")).toContain("config.retention.resultHours * 3_600_000");
  });
});

describe("money and analytics on the result page (§33–§34)", () => {
  it("the result screen never calls a balance, quote or start route, and tracks product events without media", () => {
    const r = src("features/ai/character-replace/result.tsx");
    expect(code("features/ai/character-replace/result.tsx")).not.toMatch(/reserveCharacterReplaceCharge|getCharacterReplaceQuote|startCharacterReplaceJob|beginCharacterReplaceTopup|\/api\/ai\/balance|\/quote|\/start/);
    for (const e of ["character_replace_result_viewed", "character_replace_video_played", "character_replace_download_clicked", "character_replace_saved", "character_replace_shared"]) expect(r).toContain(e);
    expect(src("features/ai/character-replace/character-replace-workspace.tsx")).toContain("character_replace_retry_clicked");
    // the properties sent are the mode/quality/view — never a URL, a name or the dialogue
    expect(r).not.toMatch(/track\([^)]*(previewUrl|source\.name|text)/);
    const types = src("lib/analytics/types.ts");
    const collect = src("app/api/analytics/collect/route.ts");
    for (const e of ["character_replace_result_viewed", "character_replace_retry_clicked"]) {
      expect(types).toContain(`"${e}"`);
      expect(collect).toContain(`"${e}"`);
    }
  });
  it("share never mints a public link; download goes through the one manager", () => {
    const r = src("features/ai/character-replace/result.tsx");
    expect(r).toContain("navigator.canShare?.({ files: [file] })");
    expect(code("features/ai/character-replace/result.tsx")).not.toMatch(/share_token|shareToken|createShare|\/api\/share|getPublicUrl/);
    expect(r).toContain("startAiResultDownload(result.job)");
    expect(r).not.toContain("<a download");
  });
  it("the AI button lives on the history page only (owner, 2026-09-14)", () => {
    const fab = src("features/ai/frenz-ai-fab.tsx");
    expect(fab).toContain('const SHOWN_PREFIXES = ["/downloads", "/history"];');
    expect(fab).not.toContain("HIDDEN_PREFIXES");
    expect(src("app/(marketing)/history/page.tsx")).toContain("<FrenzAiFab />");
  });
});
