import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_PROVIDERS_DEFAULTS, FAL_KLING_O1_EDIT, FAL_SYNC3, PROVIDER_FEATURE_DEFS, configuredVendor, isWanEndpoint, modelConfigFor, normalizeAiProvidersConfig, providerRunEstimateUsdCents, versionAiProviders } from "./config";
import { compareProviderRuns, providerHealthFromRuns, type ProviderRunRow } from "./runs";
import { buildPrepareArgs, isKnownPrepareArg, klingFrameRate, type PreparePlan } from "../character-replace/ffmpeg";
import { isTrustedProviderOutputUrl } from "../character-replace/model";
import { KLING_EDIT_INPUT_FIELDS, KLING_O1_EDIT_LIMITS, buildKlingEditInput, klingEditPrompt, klingSelectionVerdict, klingTargetGeometry, validateKlingElementImage, validateKlingInputFacts } from "../character-replace/providers/kling-input";
import { falSignedMessage, readFalWebhookHeaders, verifyFalWebhook } from "../fal/signature";
import { extractFalVideoUrl, isFalOutputHost, mapFalQueueStatus, stateFromFalWebhookBody } from "../fal/status";
import { AI_PROVIDER_IDS } from "../jobs";
import { SYNC3_INPUT_FIELDS, buildSync3Input } from "../voice/fal-sync3";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAL.AI AS A SECOND PROVIDER (2026-09-21, migration 0168) — pinned
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What is proven here is the pure layer: the configuration and its locks,
 * the Kling input and its limits, fal's webhook signature scheme against a
 * key pair this file generates, the status normalisation, the prepare
 * profile, the comparison arithmetic — and the source pins that keep the
 * routing decision on the server and the ElevenLabs lock in place. A live
 * fal.ai run needs FAL_KEY on the deployment; it is not claimed here.
 */

describe("the providers configuration (§10, §11, §17)", () => {
  it("defaults: Replicate everywhere switchable, Kling O1 Edit and Sync-3 as the fal.ai models, nothing paused, no fallback", () => {
    const c = normalizeAiProvidersConfig(null);
    expect(c.features.character_replace.provider).toBe("replicate");
    expect(c.features.lip_sync.provider).toBe("replicate");
    expect(c.models["character_replace:fal"].model).toBe(FAL_KLING_O1_EDIT);
    expect(c.models["lip_sync:fal"].model).toBe(FAL_SYNC3);
    expect(c.paused).toEqual({ replicate: false, fal: false });
    expect(c.fallback).toBe("off");
  });
  it("Text to Speech and Voice Replace are ElevenLabs whatever a patch says — the lock is structural", () => {
    const c = normalizeAiProvidersConfig({ features: { text_to_speech: { provider: "fal" }, voice_change: { provider: "replicate" } } });
    expect(c.features.text_to_speech.provider).toBe("elevenlabs");
    expect(c.features.voice_change.provider).toBe("elevenlabs");
    expect(configuredVendor(c, "text_to_speech")).toBe("elevenlabs");
    expect(configuredVendor(c, "voice_change")).toBe("elevenlabs");
    for (const f of PROVIDER_FEATURE_DEFS.filter((d) => d.locked)) expect(f.vendors).toEqual(["elevenlabs"]);
  });
  it("AI Clean is not a feature row anywhere", () => {
    expect(PROVIDER_FEATURE_DEFS.some((f) => /clean/i.test(f.id) || /clean/i.test(f.label))).toBe(false);
    expect(code("lib/ai/providers/config.ts")).not.toMatch(/ai_clean/);
  });
  it("a Wan endpoint configured on the fal.ai side is refused (the comparison is against a different model family)", () => {
    expect(isWanEndpoint("fal-ai/wan/v2.2-14b/animate/replace")).toBe(true);
    expect(isWanEndpoint("wan-video/wan-2.2-animate-replace")).toBe(true);
    expect(isWanEndpoint(FAL_KLING_O1_EDIT)).toBe(false);
    const c = normalizeAiProvidersConfig({ models: { "character_replace:fal": { model: "fal-ai/wan/v2.2-14b/animate/replace" } } });
    expect(c.models["character_replace:fal"].model).toBe(FAL_KLING_O1_EDIT);
  });
  it("the two face-swap scopes cannot be switched on for fal.ai — Kling O1 Edit does not claim them (§4)", () => {
    const c = normalizeAiProvidersConfig({ features: { character_replace: { provider: "fal", falScopes: { face_only: true, skin_face: true, upper_body: false, full_character: true } } } });
    expect(c.features.character_replace.falScopes).toEqual({ face_only: false, skin_face: false, upper_body: false, full_character: true });
  });
  it("the version bumps on a route, a model or a pause — not on notes", () => {
    const a = normalizeAiProvidersConfig(null);
    const b = versionAiProviders(a, normalizeAiProvidersConfig({ features: { character_replace: { provider: "fal" } } }));
    expect(b.version).toBe(a.version + 1);
    const c = versionAiProviders(b, normalizeAiProvidersConfig({ ...b, models: { ...b.models, "lip_sync:fal": { ...b.models["lip_sync:fal"], notes: "hello" } } }));
    expect(c.version).toBe(b.version);
    const d = versionAiProviders(c, normalizeAiProvidersConfig({ ...c, paused: { replicate: false, fal: true } }));
    expect(d.version).toBe(c.version + 1);
  });
  it("the bounds clamp: a 10 000× credit multiplier becomes 10, a negative cost 0", () => {
    const c = normalizeAiProvidersConfig({ models: { "character_replace:fal": { creditMultiplier: 10_000, costUsdCentsPerSecond: -4 } } });
    expect(c.models["character_replace:fal"].creditMultiplier).toBe(10);
    expect(c.models["character_replace:fal"].costUsdCentsPerSecond).toBe(0);
  });
  it("the run estimate is the operator's profile: per second × seconds + per run; unknown when both are 0", () => {
    const m = { ...modelConfigFor(AI_PROVIDERS_DEFAULTS, "character_replace", "fal"), costUsdCentsPerSecond: 10, costUsdCentsPerRun: 5 };
    expect(providerRunEstimateUsdCents(m, 5_000)).toBe(55);
    expect(providerRunEstimateUsdCents(modelConfigFor(AI_PROVIDERS_DEFAULTS, "character_replace", "fal"), 5_000)).toBeNull();
  });
  it("the provider id union mirrors the widened check (0168)", () => {
    expect(AI_PROVIDER_IDS).toEqual(["replicate", "fal"]);
    const sql = src("supabase/migrations/0168_ai_provider_runs.sql");
    expect(sql).toContain("check (provider in ('replicate', 'fal')) not valid");
    expect(sql).toContain("validate constraint ai_jobs_provider_chk");
    // the lesson from 0167: the ai_jobs constraint is the LAST statement
    expect(sql.trimEnd().endsWith("validate constraint ai_jobs_provider_chk;")).toBe(true);
  });
});

describe("Kling O1 Video Edit — the input and its limits (§5, §6, §29)", () => {
  const refs = ["https://x.test/prepared-1.jpg", "https://x.test/prepared-2.jpg"];
  it("builds one element (the character) with its other angles as reference images, the prompt naming @Element1, keep_audio from the request", () => {
    const input = buildKlingEditInput({ mode: "full_character", videoUrl: "https://x.test/prepared.mp4", referenceImageUrls: refs, keepAudio: true });
    expect(input.elements).toHaveLength(1);
    expect(input.elements![0]).toEqual({ frontal_image_url: refs[0], reference_image_urls: [refs[1]] });
    expect(input.image_urls).toBeUndefined();
    expect(input.keep_audio).toBe(true);
    expect(input.prompt).toContain("@Element1");
    expect(input.prompt).not.toContain("@Image1");
    for (const key of Object.keys(input)) expect(KLING_EDIT_INPUT_FIELDS).toContain(key);
  });
  it("a single photo sends the frontal image alone — no empty reference list", () => {
    const input = buildKlingEditInput({ mode: "upper_body", videoUrl: "https://x.test/p.mp4", referenceImageUrls: [refs[0]!], keepAudio: false });
    expect(input.elements![0]).toEqual({ frontal_image_url: refs[0] });
    expect(input.keep_audio).toBe(false);
  });
  it("every prompt preserves motion, expressions, camera, framing, lighting, environment and timing (§6)", () => {
    for (const mode of ["full_character", "upper_body"] as const) {
      const p = klingEditPrompt(mode);
      for (const word of ["movement", "expression", "camera", "framing", "lighting", "environment", "timing"]) expect(p.toLowerCase()).toContain(word);
    }
  });
  it("no prompt exists for the scopes the adapter does not claim — a mis-route cannot invent one", () => {
    expect(() => klingEditPrompt("face_only")).toThrow(/capability mapping/);
    expect(() => klingEditPrompt("skin_face")).toThrow(/capability mapping/);
  });
  it("refuses non-https inputs and more than the model's four references", () => {
    expect(() => buildKlingEditInput({ mode: "full_character", videoUrl: "http://x.test/p.mp4", referenceImageUrls: refs, keepAudio: false })).toThrow(/https/);
    const many = ["a", "b", "c", "d", "e"].map((s) => `https://x.test/${s}.jpg`);
    const input = buildKlingEditInput({ mode: "full_character", videoUrl: "https://x.test/p.mp4", referenceImageUrls: many, keepAudio: false });
    expect(1 + input.elements![0]!.reference_image_urls!.length).toBeLessThanOrEqual(KLING_O1_EDIT_LIMITS.maxElementsAndImages);
  });
  it("before billing: 3–10.05 s, MP4/MOV, ≤ 200 MB — a longer video is sent to the trim step, never cut", () => {
    expect(klingSelectionVerdict({ selectedDurationMs: 10_050, mime: "video/mp4", bytes: 1 })).toEqual({ ok: true });
    const long = klingSelectionVerdict({ selectedDurationMs: 10_051, mime: "video/mp4", bytes: 1 });
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.code).toBe("too_long");
      expect(long.message).toMatch(/Trim/);
      expect(long.message).toMatch(/nothing has been charged/);
    }
    expect(klingSelectionVerdict({ selectedDurationMs: 2_999, mime: "video/mp4", bytes: 1 })).toMatchObject({ ok: false, code: "too_short" });
    expect(klingSelectionVerdict({ selectedDurationMs: 5_000, mime: "video/quicktime", bytes: 1 })).toEqual({ ok: true });
    expect(klingSelectionVerdict({ selectedDurationMs: 5_000, mime: "video/webm", bytes: 1 })).toMatchObject({ ok: false, code: "container" });
    expect(klingSelectionVerdict({ selectedDurationMs: 5_000, mime: "video/mp4", bytes: 200 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, code: "too_big" });
    // the quote knows neither mime nor bytes yet — only the length is judged
    expect(klingSelectionVerdict({ selectedDurationMs: 15_000, mime: null, bytes: null })).toMatchObject({ ok: false, code: "too_long" });
  });
  it("before submission: the prepared file must sit inside every documented limit", () => {
    expect(validateKlingInputFacts({ durationMs: 5_000, width: 1280, height: 720, bytes: 10_000, fps: 30 })).toEqual({ ok: true });
    expect(validateKlingInputFacts({ durationMs: 5_000, width: 1280, height: 548, bytes: 10_000, fps: 30 })).toMatchObject({ ok: false });
    expect(validateKlingInputFacts({ durationMs: 5_000, width: 3840, height: 2160, bytes: 10_000, fps: 30 })).toMatchObject({ ok: false });
    expect(validateKlingInputFacts({ durationMs: 5_000, width: 1280, height: 720, bytes: 10_000, fps: 15 })).toMatchObject({ ok: false });
    expect(validateKlingInputFacts({ durationMs: 5_000, width: 1280, height: 720, bytes: 10_000, fps: 120 })).toMatchObject({ ok: false });
    expect(validateKlingInputFacts({ durationMs: 12_000, width: 1280, height: 720, bytes: 10_000, fps: 30 })).toMatchObject({ ok: false });
  });
  it("the element image limits: ≥ 300 px, aspect 0.40–2.50, ≤ 10 MB", () => {
    expect(validateKlingElementImage({ width: 1080, height: 1440, bytes: 500_000 })).toEqual({ ok: true });
    expect(validateKlingElementImage({ width: 200, height: 400, bytes: 500_000 })).toMatchObject({ ok: false });
    expect(validateKlingElementImage({ width: 3000, height: 1000, bytes: 500_000 })).toMatchObject({ ok: false });
    expect(validateKlingElementImage({ width: 1080, height: 1440, bytes: 11 * 1024 * 1024 })).toMatchObject({ ok: false });
  });
  it("the target geometry: a 21:9 clip is raised to 720 tall; 4K is capped; a fitting clip is left alone", () => {
    expect(klingTargetGeometry({ width: 1280, height: 548 }, 1280)).toEqual({ width: 1682, height: 720 });
    const uhd = klingTargetGeometry({ width: 3840, height: 2160 }, 1280)!;
    expect(uhd.width).toBe(1280);
    expect(uhd.height).toBe(720);
    expect(klingTargetGeometry({ width: 1280, height: 720 }, 1280)).toBeNull();
    expect(klingTargetGeometry({ width: 720, height: 1280 }, 1280)).toBeNull();
  });
});

describe("the prepare plan's Kling profile (the worker)", () => {
  const base: PreparePlan = { input: "/tmp/in.bin", output: "/tmp/out.mp4", startMs: 0, endMs: null };
  it("the default plan is exactly what it was — no frame-rate argument, the original scale filter", () => {
    const args = buildPrepareArgs(base);
    expect(args).not.toContain("-r");
    expect(args.find((a) => a.startsWith("scale="))).toContain("min(iw,1920)");
    for (const a of args) expect(isKnownPrepareArg(a, base)).toBe(true);
  });
  it("the Kling profile raises the short edge to 720, caps the long edge at 2160 and clamps the rate into 24–60", () => {
    const plan: PreparePlan = { ...base, profile: "kling", frameRate: klingFrameRate(15) };
    const args = buildPrepareArgs(plan);
    const scale = args.find((a) => a.startsWith("scale="))!;
    expect(scale).toContain("720");
    expect(scale).toContain("2160");
    expect(args.slice(args.indexOf("-r"), args.indexOf("-r") + 2)).toEqual(["-r", "24"]);
    for (const a of args) expect(isKnownPrepareArg(a, plan)).toBe(true);
    expect(klingFrameRate(30)).toBeNull();
    expect(klingFrameRate(120)).toBe(60);
    expect(klingFrameRate(null)).toBe(30);
    expect(buildPrepareArgs({ ...base, profile: "kling", frameRate: klingFrameRate(30) })).not.toContain("-r");
  });
  it("an unknown rate is never passed to ffmpeg", () => {
    const args = buildPrepareArgs({ ...base, profile: "kling", frameRate: 25 as unknown as 24 });
    expect(args).not.toContain("-r");
  });
});

describe("fal.ai webhooks — the signature (§15, §23)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  const body = JSON.stringify({ request_id: "req-1", status: "OK", payload: { video: { url: "https://v3b.fal.media/files/a/out.mp4" } } });
  const now = 1_800_000_000;
  const headersFor = (b: string, ts = String(now), reqId = "req-1") => {
    const message = falSignedMessage({ requestId: reqId, userId: "user-1", timestamp: ts }, b);
    const signature = sign(null, message, privateKey).toString("hex");
    return { requestId: reqId, userId: "user-1", timestamp: ts, signature };
  };
  it("the message is requestId \\n userId \\n timestamp \\n sha256hex(body), signed as-is", () => {
    const m = falSignedMessage({ requestId: "r", userId: "u", timestamp: "1" }, "body").toString("utf8");
    expect(m).toBe(["r", "u", "1", createHash("sha256").update("body").digest("hex")].join("\n"));
  });
  it("verifies a genuine delivery against the JWKS, with any of the live keys", () => {
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }) as { x: string };
    expect(verifyFalWebhook({ headers: headersFor(body), rawBody: body, keys: [{ kty: "OKP", crv: "Ed25519", x: other.x }, jwk], nowSeconds: now })).toEqual({ valid: true, keyIndex: 1 });
  });
  it("refuses a tampered body, a stale timestamp, a malformed signature, missing headers, and a set without a matching key", () => {
    expect(verifyFalWebhook({ headers: headersFor(body), rawBody: body.replace("out.mp4", "evil.mp4"), keys: [jwk], nowSeconds: now })).toEqual({ valid: false, reason: "no-match" });
    expect(verifyFalWebhook({ headers: headersFor(body, String(now - 301)), rawBody: body, keys: [jwk], nowSeconds: now })).toEqual({ valid: false, reason: "stale" });
    expect(verifyFalWebhook({ headers: { ...headersFor(body), signature: "zz" }, rawBody: body, keys: [jwk], nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    expect(verifyFalWebhook({ headers: { ...headersFor(body), userId: null }, rawBody: body, keys: [jwk], nowSeconds: now })).toEqual({ valid: false, reason: "missing-headers" });
    const stranger = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }) as { x: string };
    expect(verifyFalWebhook({ headers: headersFor(body), rawBody: body, keys: [{ kty: "OKP", crv: "Ed25519", x: stranger.x }], nowSeconds: now })).toEqual({ valid: false, reason: "no-match" });
    expect(verifyFalWebhook({ headers: headersFor(body), rawBody: body, keys: [], nowSeconds: now })).toEqual({ valid: false, reason: "no-keys" });
  });
  it("reads the four documented headers, case-insensitively", () => {
    const h = readFalWebhookHeaders(new Headers({ "X-Fal-Webhook-Request-Id": "r", "X-Fal-Webhook-User-Id": "u", "X-Fal-Webhook-Timestamp": "1", "X-Fal-Webhook-Signature": "ab" }));
    expect(h).toEqual({ requestId: "r", userId: "u", timestamp: "1", signature: "ab" });
  });
  it("the route reads the raw text before parsing and hands a verified state to the shared handler", () => {
    const route = code("app/api/webhooks/fal/route.ts");
    expect(route.indexOf("request.text()")).toBeGreaterThan(-1);
    expect(route.indexOf("request.text()")).toBeLessThan(route.indexOf("JSON.parse"));
    expect(route.indexOf("verifyFalWebhook")).toBeLessThan(route.indexOf("JSON.parse"));
    expect(route).toContain('handleProviderCallback(state, { provider: "fal"');
    expect(route).not.toContain("request.json()");
    const replicate = code("app/api/ai/replicate/webhook/route.ts");
    expect(replicate).toContain('handleProviderCallback(state, { provider: "replicate"');
    expect(replicate.indexOf("verifyReplicateWebhook")).toBeLessThan(replicate.indexOf("JSON.parse"));
  });
  it("the shared handler refuses a delivery for another provider's job and keeps the CAS transitions", () => {
    const h = code("lib/ai/webhook-handler.ts");
    expect(h).toContain('(job.provider ?? "replicate") !== provider');
    expect(h).toContain('transitionJob(job.id, ["queued"], "processing"');
    expect(h).toContain('transitionJob(jobId, ["queued", "processing"], "failed"');
    expect(h).toContain("closeProviderRun");
  });
});

describe("fal.ai status normalisation", () => {
  it("queue statuses map, unknown ones are null", () => {
    expect(mapFalQueueStatus("IN_QUEUE")).toBe("queued");
    expect(mapFalQueueStatus("IN_PROGRESS")).toBe("processing");
    expect(mapFalQueueStatus("COMPLETED")).toBe("completed");
    expect(mapFalQueueStatus("WEIRD")).toBeNull();
  });
  it("OK + video → completed with the url; ERROR → failed with the detail; OK without a video → completed with no url (the handler refunds it)", () => {
    expect(stateFromFalWebhookBody({ request_id: "r", status: "OK", payload: { video: { url: "https://v3.fal.media/x.mp4" } } })).toMatchObject({ reference: "r", status: "completed", resultUrl: "https://v3.fal.media/x.mp4", detail: null });
    expect(stateFromFalWebhookBody({ request_id: "r", status: "ERROR", error: "boom", payload: { detail: "bad" } })).toMatchObject({ reference: "r", status: "failed", resultUrl: null });
    expect(stateFromFalWebhookBody({ request_id: "r", status: "OK", payload: null, payload_error: "not serialisable" })).toMatchObject({ status: "completed", resultUrl: null, detail: "not serialisable" });
    expect(stateFromFalWebhookBody({ status: "OK" })).toBeNull();
    expect(stateFromFalWebhookBody({ request_id: "r", status: "PENDING" })).toBeNull();
  });
  it("the output url is found in the shapes fal uses, https only", () => {
    expect(extractFalVideoUrl({ video: { url: "https://a/b.mp4" } })).toBe("https://a/b.mp4");
    expect(extractFalVideoUrl({ video_url: "https://a/c.mp4" })).toBe("https://a/c.mp4");
    expect(extractFalVideoUrl({ video: { url: "http://a/b.mp4" } })).toBeNull();
    expect(extractFalVideoUrl("nope")).toBeNull();
  });
  it("the worker follows an output url to fal.media and replicate.delivery only", () => {
    expect(isTrustedProviderOutputUrl("https://v3b.fal.media/files/a/out.mp4")).toBe(true);
    expect(isTrustedProviderOutputUrl("https://replicate.delivery/x/out.mp4")).toBe(true);
    expect(isTrustedProviderOutputUrl("https://fal.media.evil.com/out.mp4")).toBe(false);
    expect(isTrustedProviderOutputUrl("http://v3.fal.media/out.mp4")).toBe(false);
    expect(isFalOutputHost("v3.fal.media")).toBe(true);
  });
});

describe("Sync-3 on fal.ai — audio-driven only (§16)", () => {
  it("sends video_url, audio_url and a sync mode from the operator's three — never cut_off, never text, nothing else", () => {
    const input = buildSync3Input({ videoUrl: "https://x/v.mp4", audioUrl: "https://x/a.wav", syncMode: "bounce" });
    expect(Object.keys(input).sort()).toEqual([...SYNC3_INPUT_FIELDS].sort());
    expect(input.sync_mode).toBe("bounce");
    expect(buildSync3Input({ videoUrl: "https://x/v.mp4", audioUrl: "https://x/a.wav", syncMode: "cut_off" as never }).sync_mode).toBe("silence");
    expect(() => buildSync3Input({ videoUrl: "http://x/v.mp4", audioUrl: "https://x/a.wav", syncMode: "silence" })).toThrow();
    expect(code("lib/ai/voice/fal-sync3.ts")).not.toMatch(/text:/);
  });
});

describe("the routing stays on the server and on the row (§9, §21, §22)", () => {
  it("/start decides the route once, refuses an unsupported scope or a paused vendor before any claim, and stamps the row", () => {
    const s = code("lib/ai/character-replace/start-job.ts");
    expect(s.indexOf("resolveReplacementRoute(")).toBeLessThan(s.indexOf("claimJobStart("));
    expect(s.indexOf("klingSelectionVerdict(")).toBeLessThan(s.indexOf("claimJobStart("));
    expect(s).toContain('"CR_SCOPE_UNAVAILABLE"');
    expect(s).toContain('"CR_ENGINE_LIMIT"');
    expect(s).toContain("stampJobProvider(job.id, plannedProvider.id");
    expect(s).toContain("provider.refused");
  });
  it("the submit step reads the ROW's plan, never today's switch, and points each vendor at its own webhook", () => {
    const s = code("lib/ai/character-replace/submit.ts");
    expect(s).toContain("readProviderPlan(fresh.metadata)");
    expect(s).toContain("stageVendor(fresh, stage)");
    expect(s).toContain("/api/webhooks/fal");
    expect(s).toContain("/api/ai/replicate/webhook");
    expect(s).not.toContain("resolveReplacementRoute(");
    expect(s).toContain("openProviderRun(");
  });
  it("the reconciler and the cancel route ask the job's own vendor, with the row's model", () => {
    expect(code("lib/ai/reconcile.ts")).toContain("providerFor(job.feature === \"ai_character_replace\" ? jobVendor(job) : feature.provider)");
    expect(code("lib/ai/reconcile.ts")).toContain("provider.poll(job.replicate_prediction_id, { model: job.model })");
    expect(code("app/api/ai/jobs/[id]/cancel/route.ts")).toContain("provider.cancel(job.replicate_prediction_id, { model: job.model })");
  });
  it("no automatic fallback exists: nothing moves a job between vendors", () => {
    for (const f of ["lib/ai/providers/resolve.ts", "lib/ai/character-replace/submit.ts", "lib/ai/webhook-handler.ts", "lib/ai/reconcile.ts"]) {
      const s = code(f);
      expect(s).not.toMatch(/fallbackTo|retryOn(Other|Fal|Replicate)|switchProvider\(/);
    }
    expect(AI_PROVIDERS_DEFAULTS.fallback).toBe("off");
  });
  it("FAL_KEY is read in one server-only file and nothing under features/ or a public route names it", () => {
    expect(code("lib/ai/fal/client.ts")).toContain("process.env.FAL_KEY");
    expect(src("lib/ai/fal/client.ts").startsWith('import "server-only";')).toBe(true);
    expect(code("features/admin/ai-providers-settings.tsx")).not.toContain("FAL_KEY");
    expect(code("app/api/admin/ai/providers/test/route.ts")).not.toContain("process.env");
  });
  it("the admin patch cannot name a provider for the locked features (strict zod)", () => {
    const s = code("app/api/admin/landing/route.ts");
    const block = s.slice(s.indexOf("frenzAiProviders: z"), s.indexOf("frenzAiCharacterReplace: z"));
    expect(block).not.toContain("text_to_speech");
    expect(block).not.toContain("voice_change");
    expect(block).toContain(".strict()");
  });
});

describe("the provider ledger arithmetic (§19, §20, §26)", () => {
  const row = (over: Partial<ProviderRunRow>): ProviderRunRow => ({
    id: Math.random().toString(36).slice(2),
    job_id: "j",
    user_id: "u",
    feature: "ai_character_replace",
    mode: "full_character",
    stage: "replace",
    provider: "fal",
    model: FAL_KLING_O1_EDIT,
    model_version: null,
    provider_job_id: Math.random().toString(36).slice(2),
    status: "succeeded",
    test: false,
    submitted_at: "2026-09-21T10:00:00.000Z",
    started_at: "2026-09-21T10:00:30.000Z",
    completed_at: "2026-09-21T10:02:30.000Z",
    latency_ms: 400,
    input_duration_ms: 5000,
    input_resolution: "1280x720",
    cost_estimate_usd_cents: 50,
    cost_actual_usd_cents: null,
    error_code: null,
    error_detail: null,
    output_ref: null,
    ...over,
  });
  it("counts, rates, averages and costs per feature/provider/model; tests apart; estimates never become actuals", () => {
    const rows = [row({}), row({}), row({ status: "failed", error_code: "PROCESSING_FAILED", completed_at: "2026-09-21T10:01:30.000Z" }), row({ test: true }), row({ provider: "replicate", model: "wan", cost_actual_usd_cents: 12 })];
    const cmp = compareProviderRuns(rows);
    const fal = cmp.find((c) => c.provider === "fal")!;
    expect(fal.jobs).toBe(3);
    expect(fal.succeeded).toBe(2);
    expect(fal.failed).toBe(1);
    expect(fal.successRate).toBe(66.7);
    expect(fal.testRuns).toBe(1);
    expect(fal.avgQueueMs).toBe(30_000);
    expect(fal.avgTotalMs).toBe(150_000);
    expect(fal.estimatedCostUsdCents).toBe(150);
    expect(fal.actualCostUsdCents).toBeNull();
    expect(fal.failures).toEqual([{ code: "PROCESSING_FAILED", count: 1 }]);
    const rep = cmp.find((c) => c.provider === "replicate")!;
    expect(rep.actualCostUsdCents).toBe(12);
    expect(cmp.some((c) => "winner" in c || "score" in c)).toBe(false);
  });
  it("health: last success / failure per vendor, the recent error, credentials as booleans", () => {
    const rows = [row({ completed_at: "2026-09-21T10:02:30.000Z" }), row({ status: "failed", error_code: "X", error_detail: "boom", completed_at: "2026-09-21T11:00:00.000Z" })];
    const h = providerHealthFromRuns(rows, { replicate: true, fal: false, elevenlabs: true });
    const fal = h.find((x) => x.provider === "fal")!;
    expect(fal.credentials).toBe(false);
    expect(fal.lastSuccessAt).toBe("2026-09-21T10:02:30.000Z");
    expect(fal.lastFailureAt).toBe("2026-09-21T11:00:00.000Z");
    expect(fal.recentError).toMatchObject({ code: "X", detail: "boom" });
    expect(h.map((x) => x.provider)).toEqual(["replicate", "fal", "elevenlabs"]);
  });
});
