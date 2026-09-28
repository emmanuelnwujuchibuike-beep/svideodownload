import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isDirectKlingBaseUrl,
  isKlingOutputHost,
  isValidKlingModelId,
  klingOmniVideoPath,
  KLING_ALLOWED_API_HOSTS,
  KLING_DEFAULT_BASE_URL,
  KLING_JWT_NOT_BEFORE_SKEW_SECONDS,
  KLING_JWT_TTL_SECONDS,
  KLING_OMNI_MODEL,
} from "./config";
import {
  klingJwt,
  klingJwtClaims,
  klingSigningKey,
  klingStandardWebhookContent,
  readKlingCallbackHeaders,
  signKlingCallbackForTest,
  signKlingSimpleForTest,
  verifyKlingCallback,
} from "./signature";
import {
  extractKlingVideoDurationSeconds,
  extractKlingBilledUnits,
  extractKlingVideoUrl,
  klingDataFromEnvelope,
  klingExternalTaskId,
  klingTaskId,
  mapKlingTaskStatus,
  stateFromKlingCallbackBody,
  stateFromKlingTask,
} from "./status";
import { AI_PROVIDER_IDS } from "../jobs";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** The STATEMENTS of a migration, with its `--` prose removed — a comment is not a schema change. */
const sqlCode = (p: string) => src(p).replace(/^\s*--.*$/gm, "").trim();

/**
 * ── ⚠️ "kling" IS AN AMBIGUOUS WORD IN THIS REPOSITORY ──────────────────────
 *
 * Kling MODELS have been reachable through fal.ai since 2026-09-21
 * (`fal-ai/kling-video/o1/...`, `KLING_O1_EDIT_LIMITS`, `KLING_LIP_SYNC_*`),
 * and that code is legitimate, live and out of scope for Part 2. So a guard
 * that merely greps for /kling/i fires on the old vendor's code and proves
 * nothing about the new one.
 *
 * The assertions below therefore name what is actually new: the DIRECT seam's
 * module path, its credentials, and `"kling"` as a PROVIDER VALUE.
 */
const DIRECT_SEAM_PATH = "lib/ai/kling/";
const KLING_CREDENTIALS = ["KLING_API_KEY", "KLING_ACCESS_KEY", "KLING_SECRET_KEY", "KLING_WEBHOOK_SECRET"] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DIRECT KLING SEAM (2026-09-28, migration Part 2) — pinned
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What is proven here is the pure layer and the promises Part 2 makes in
 * prose: the JWT's claims, both callback signature schemes against secrets
 * this file generates, the status normalisation, the task-id mapping, the
 * direct-host refusal, the widened constraint, and — most importantly — that
 * NOTHING ROUTES TO KLING. A live Kling run needs a credential on the
 * deployment; it is not claimed here.
 *
 * Every guard below has a case that FAILS on a bad fixture. A test that
 * cannot fail proves nothing (AGENTS.md golden rule 3).
 */

describe("Kling — the endpoints and the direct-only rule (§5)", () => {
  it("the default base URL is one of Kling's OWN hosts, over https", () => {
    expect(isDirectKlingBaseUrl(KLING_DEFAULT_BASE_URL)).toBe(true);
    expect(new URL(KLING_DEFAULT_BASE_URL).protocol).toBe("https:");
    expect(KLING_ALLOWED_API_HOSTS).toContain(new URL(KLING_DEFAULT_BASE_URL).hostname);
  });

  it("🔴 refuses every aggregator, and http — the whole point of a DIRECT integration", () => {
    for (const bad of [
      "https://api.replicate.com",
      "https://fal.run",
      "https://queue.fal.run",
      "https://api.kie.ai",
      "https://api.piapi.ai",
      "https://api.pollo.ai",
      "https://api.klingapi.com",
      "https://klingai.com.evil.test",
      "http://api-singapore.klingai.com",
      "not a url",
      "",
    ]) {
      expect(isDirectKlingBaseUrl(bad), bad).toBe(false);
    }
  });

  it("the model is a PATH SEGMENT, so anything that is not a plain identifier is refused", () => {
    expect(klingOmniVideoPath(KLING_OMNI_MODEL)).toBe(`/omni-video/${KLING_OMNI_MODEL}`);
    expect(isValidKlingModelId(KLING_OMNI_MODEL)).toBe(true);
    for (const bad of ["../../v1/videos", "kling/../x", "a?b=c", "a b", "a#b", "/leading", "", "a".repeat(200)]) {
      expect(isValidKlingModelId(bad), bad).toBe(false);
      expect(() => klingOmniVideoPath(bad)).toThrow();
    }
  });

  it("only Kling's own delivery hosts are recognised as output hosts", () => {
    expect(isKlingOutputHost("cdn.klingai.com")).toBe(true);
    expect(isKlingOutputHost("v.kwaicdn.com")).toBe(true);
    expect(isKlingOutputHost("fal.media")).toBe(false);
    expect(isKlingOutputHost("replicate.delivery")).toBe(false);
    expect(isKlingOutputHost("klingai.com.attacker.test")).toBe(false);
    expect(isKlingOutputHost("")).toBe(false);
  });
});

describe("Kling — the AK/SK JWT (outbound signing)", () => {
  const accessKey = "AK_test_1234";
  const secretKey = "SK_test_abcdef";
  const now = 1_800_000_000;

  it("the claims are the documented ones: iss = the ACCESS key, exp = +30 min, nbf = a few seconds in the past", () => {
    const claims = klingJwtClaims(accessKey, now);
    expect(claims.iss).toBe(accessKey);
    expect(claims.exp).toBe(now + KLING_JWT_TTL_SECONDS);
    expect(claims.nbf).toBe(now - KLING_JWT_NOT_BEFORE_SKEW_SECONDS);
    expect(KLING_JWT_TTL_SECONDS).toBe(30 * 60);
  });

  it("mints a verifiable HS256 token — header, claims and a signature over `header.payload`", () => {
    const token = klingJwt({ accessKey, secretKey, nowSeconds: now });
    const [h, p, s] = token.split(".");
    expect(h && p && s).toBeTruthy();

    const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    expect(decode(h!)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decode(p!)).toEqual(klingJwtClaims(accessKey, now));

    const expected = createHmac("sha256", secretKey).update(`${h}.${p}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(s).toBe(expected);
  });

  it("🔴 the SECRET key never appears in the token", () => {
    const token = klingJwt({ accessKey, secretKey, nowSeconds: now });
    expect(token).not.toContain(secretKey);
    expect(Buffer.from(token).toString("utf8")).not.toContain(secretKey);
  });

  it("a wrong secret produces a different signature — the token is not merely encoded", () => {
    const a = klingJwt({ accessKey, secretKey, nowSeconds: now });
    const b = klingJwt({ accessKey, secretKey: "SK_other", nowSeconds: now });
    expect(a.split(".")[2]).not.toBe(b.split(".")[2]);
  });

  it("refuses to mint without both halves of the pair", () => {
    expect(() => klingJwt({ accessKey: "", secretKey })).toThrow();
    expect(() => klingJwt({ accessKey, secretKey: "  " })).toThrow();
  });
});

describe("Kling — verifying a callback (inbound)", () => {
  const secret = "whsec_" + Buffer.from("a-thirty-two-byte-test-key-00000").toString("base64");
  const rawBody = JSON.stringify({ code: 0, data: { task_id: "task_abc", task_status: "succeed" } });
  const now = 1_800_000_000;
  const ts = String(now);
  const id = "msg_2abc";

  const headers = (init: Record<string, string>) => readKlingCallbackHeaders(new Headers(init));

  it("scheme A (Standard Webhooks): a correctly signed delivery verifies", () => {
    const signature = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret });
    const verdict = verifyKlingCallback({ headers: headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signature }), rawBody, secret, nowSeconds: now });
    expect(verdict).toEqual({ valid: true, scheme: "standard-webhooks" });
  });

  it("scheme A: the signed content is `id.timestamp.body`, and a tampered BODY fails", () => {
    expect(klingStandardWebhookContent(id, ts, rawBody)).toBe(`${id}.${ts}.${rawBody}`);
    const signature = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret });
    const tampered = rawBody.replace("task_abc", "task_theirs");
    const verdict = verifyKlingCallback({ headers: headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signature }), rawBody: tampered, secret, nowSeconds: now });
    expect(verdict).toEqual({ valid: false, reason: "no-match" });
  });

  it("scheme A: several space-separated signatures let a secret rotate — any one matching is enough", () => {
    const good = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret });
    const stale = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret: "whsec_" + Buffer.from("an-old-rotated-out-key-000000000").toString("base64") });
    const verdict = verifyKlingCallback({ headers: headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `${stale} ${good}` }), rawBody, secret, nowSeconds: now });
    expect(verdict.valid).toBe(true);
  });

  it("scheme B (sha256=hex over the raw body): verifies, and a tampered body fails", () => {
    const signature = signKlingSimpleForTest({ rawBody, secret });
    expect(verifyKlingCallback({ headers: headers({ "x-kling-signature": signature }), rawBody, secret, nowSeconds: now })).toEqual({ valid: true, scheme: "sha256" });
    expect(verifyKlingCallback({ headers: headers({ "x-kling-signature": signature }), rawBody: rawBody + " ", secret, nowSeconds: now })).toEqual({ valid: false, reason: "no-match" });
  });

  it("🔴 a stale delivery is refused even though it is genuinely signed — a replay guard, not a clock check", () => {
    const signature = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret });
    const verdict = verifyKlingCallback({ headers: headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signature }), rawBody, secret, nowSeconds: now + 3600 });
    expect(verdict).toEqual({ valid: false, reason: "stale" });
  });

  it("🔴 refuses an unsigned delivery, a missing secret, and a garbage signature", () => {
    expect(verifyKlingCallback({ headers: headers({}), rawBody, secret, nowSeconds: now })).toEqual({ valid: false, reason: "missing-headers" });
    expect(verifyKlingCallback({ headers: headers({ "x-kling-signature": "sha256=zzzz" }), rawBody, secret, nowSeconds: now })).toEqual({ valid: false, reason: "bad-signature" });
    const signature = signKlingCallbackForTest({ id, timestamp: ts, rawBody, secret });
    expect(verifyKlingCallback({ headers: headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signature }), rawBody, secret: "", nowSeconds: now })).toEqual({ valid: false, reason: "no-secret" });
    // scheme A with its id missing is incomplete, not "close enough"
    expect(verifyKlingCallback({ headers: headers({ "webhook-timestamp": ts, "webhook-signature": signature }), rawBody, secret, nowSeconds: now })).toEqual({ valid: false, reason: "missing-headers" });
  });

  it("a `whsec_` secret signs with its DECODED bytes; a plain secret signs as itself", () => {
    expect(klingSigningKey(secret).toString("utf8")).toBe("a-thirty-two-byte-test-key-00000");
    expect(klingSigningKey("plain-secret").toString("utf8")).toBe("plain-secret");
    // a value that merely starts with the prefix but is not base64 stays literal
    expect(klingSigningKey("whsec_not!base64").toString("utf8")).toBe("whsec_not!base64");
  });
});

describe("Kling — the status vocabulary, translated once", () => {
  it("maps the vendor's words to ours, both spellings of success", () => {
    expect(mapKlingTaskStatus("submitted")).toBe("queued");
    expect(mapKlingTaskStatus("processing")).toBe("processing");
    expect(mapKlingTaskStatus("succeed")).toBe("completed");
    expect(mapKlingTaskStatus("succeeded")).toBe("completed");
    expect(mapKlingTaskStatus("failed")).toBe("failed");
    expect(mapKlingTaskStatus("PROCESSING")).toBe("processing");
  });

  it("🔴 an unknown status maps to null so every caller leaves the job alone", () => {
    for (const unknown of ["paused", "moderating", "", null, undefined, "unknown"]) {
      expect(mapKlingTaskStatus(unknown), String(unknown)).toBeNull();
    }
  });

  it("reads the task id and the echoed external handle from either field name", () => {
    expect(klingTaskId({ task_id: "t1" })).toBe("t1");
    expect(klingTaskId({ id: "t2" })).toBe("t2");
    expect(klingTaskId({})).toBeNull();
    expect(klingExternalTaskId({ external_task_id: "job-1" })).toBe("job-1");
    expect(klingExternalTaskId({ task_info: { external_task_id: "job-2" } })).toBe("job-2");
    expect(klingExternalTaskId({})).toBeNull();
  });

  /*
    🔴 The REAL success shape, verified against the live API on 2026-09-28:

      "outputs": [ { "type": "video", "id": "…", "url": "https://…", "duration": "5.041" } ]

    Part 2 read `task_result.videos[].url` from a mirror. That field is empty on
    a genuine Omni success, so a finished, BILLED video came back as "no video"
    and was refunded. This test is the teeth on that: the first assertion fails
    against the old reader.
  */
  it("🔴 takes the video URL out of outputs[] — the verified Omni success shape", () => {
    const succeeded = { id: "t1", status: "succeeded", outputs: [{ type: "video", id: "v1", url: "https://cdn.klingai.com/a.mp4", duration: "5.041" }] };
    expect(extractKlingVideoUrl(succeeded)).toBe("https://cdn.klingai.com/a.mp4");
    expect(extractKlingVideoDurationSeconds(succeeded)).toBeCloseTo(5.041);
    expect(extractKlingVideoUrl({ outputs: [{ type: "video", url: "http://cdn.klingai.com/a.mp4" }] })).toBeNull();
    expect(extractKlingVideoUrl({ outputs: [] })).toBeNull();
    expect(extractKlingVideoUrl(null)).toBeNull();
  });

  it("still reads the legacy /v1 result envelope, which the Lip Sync endpoint uses", () => {
    expect(extractKlingVideoUrl({ task_result: { videos: [{ id: "v1", url: "https://cdn.klingai.com/a.mp4", duration: "5.0" }] } })).toBe("https://cdn.klingai.com/a.mp4");
    expect(extractKlingVideoDurationSeconds({ task_result: { videos: [{ url: "https://cdn.klingai.com/a.mp4", duration: "5.0" }] } })).toBe(5);
    expect(extractKlingVideoUrl({ task_result: { videos: [{ url: "http://cdn.klingai.com/a.mp4" }] } })).toBeNull();
  });

  /*
    The vendor reports what it charged, in UNITS, on the task itself — verified:
    `[{"charge_type":"unit","amount":"3","package_type":"video"}]`, and
    `[{"amount":"0"}]` on a task that failed before generating.

    🔴 "no billing line" is NOT zero. A task still running has none at all, and
    reading that as free would understate real spend in the admin's own figures.
  */
  it("🔴 reads the billed UNITS, and tells 'nothing reported' apart from 'zero'", () => {
    expect(extractKlingBilledUnits({ billing: [{ charge_type: "unit", amount: "3", package_type: "video" }] })).toBe(3);
    expect(extractKlingBilledUnits({ billing: [{ amount: "0" }] })).toBe(0);
    expect(extractKlingBilledUnits({ billing: [{ amount: "2" }, { amount: "1.5" }] })).toBe(3.5);
    expect(extractKlingBilledUnits({ billing: [] })).toBeNull();
    expect(extractKlingBilledUnits({})).toBeNull();
    expect(extractKlingBilledUnits({ billing: [{ charge_type: "unit" }] })).toBeNull();
  });

  it("a finished task becomes a completed state carrying the output URL", () => {
    const state = stateFromKlingTask({ task_id: "t1", task_status: "succeed", task_result: { videos: [{ url: "https://cdn.klingai.com/a.mp4" }] } });
    expect(state).toEqual({ reference: "t1", status: "completed", modelVersion: null, resultUrl: "https://cdn.klingai.com/a.mp4", detail: null });
  });

  it("🔴 a success with no video is a real outcome, not a silent completion", () => {
    const state = stateFromKlingTask({ task_id: "t1", task_status: "succeed", task_result: { videos: [] } });
    expect(state?.status).toBe("completed");
    expect(state?.resultUrl).toBeNull();
    expect(state?.detail).toContain("no video");
  });

  it("a failure carries the vendor's message, trimmed, and never a result URL", () => {
    const state = stateFromKlingTask({ task_id: "t1", task_status: "failed", task_status_msg: "content moderation" });
    expect(state).toEqual({ reference: "t1", status: "failed", modelVersion: null, resultUrl: null, detail: "content moderation" });
    const long = stateFromKlingTask({ task_id: "t1", task_status: "failed", task_status_msg: "x".repeat(9000) });
    expect(long!.detail!.length).toBe(2000);
  });

  it("modelVersion is null — Kling publishes no immutable per-run version, and inventing one would be a fabrication", () => {
    expect(stateFromKlingTask({ task_id: "t1", task_status: "processing" })?.modelVersion).toBeNull();
  });

  it("unwraps the envelope, a list answer, and a bare task — and refuses a non-zero code", () => {
    expect(klingDataFromEnvelope({ code: 0, data: { task_id: "t1" } })?.task_id).toBe("t1");
    expect(klingDataFromEnvelope({ code: 0, data: [{ task_id: "t1" }] })?.task_id).toBe("t1");
    expect(klingDataFromEnvelope({ task_id: "t1" })?.task_id).toBe("t1");
    expect(klingDataFromEnvelope({ code: 1002, message: "nope" })).toBeNull();
    expect(klingDataFromEnvelope(null)).toBeNull();
    expect(klingDataFromEnvelope("string")).toBeNull();
  });

  it("a callback body and a query answer produce the SAME state — one mapper, so a duplicate is a no-op", () => {
    const envelope = { code: 0, message: "success", request_id: "r1", data: { task_id: "t1", task_status: "succeed", task_result: { videos: [{ url: "https://cdn.klingai.com/a.mp4" }] } } };
    expect(stateFromKlingCallbackBody(envelope)).toEqual(stateFromKlingTask(envelope.data));
  });

  it("🔴 a callback about a task with an unknown status changes nothing", () => {
    expect(stateFromKlingCallbackBody({ code: 0, data: { task_id: "t1", task_status: "moderating" } })).toBeNull();
    expect(stateFromKlingCallbackBody({ code: 0, data: { task_status: "succeed" } })).toBeNull();
  });
});

describe("Kling — the job integration, and the promise that nothing routes to it (§19)", () => {
  it("the provider id union and the widened constraint agree (0178)", () => {
    expect(AI_PROVIDER_IDS).toContain("kling");
    const sql = src("supabase/migrations/0178_ai_kling_provider.sql");
    expect(sql).toContain("check (provider in ('replicate', 'fal', 'kling')) not valid");
    expect(sql).toContain("check (provider in ('replicate', 'fal', 'elevenlabs', 'kling')) not valid");
    // the 0167/0168 lesson: the ai_jobs constraint is the LAST statement
    expect(sql.trimEnd().endsWith("validate constraint ai_jobs_provider_chk;")).toBe(true);
  });

  it("🔴 the migration keeps every existing provider value valid — no history is invalidated", () => {
    const sql = src("supabase/migrations/0178_ai_kling_provider.sql");
    const jobs = sql.match(/ai_jobs_provider_chk check \(provider in \(([^)]*)\)\)/)![1]!;
    const runs = sql.match(/ai_provider_runs_provider_chk check \(provider in \(([^)]*)\)\)/)![1]!;
    for (const kept of ["'replicate'", "'fal'"]) expect(jobs, kept).toContain(kept);
    for (const kept of ["'replicate'", "'fal'", "'elevenlabs'"]) expect(runs, kept).toContain(kept);
  });

  it("🔴 the migration does NOT rename or weaken replicate_prediction_id — the shared idempotency key (§13)", () => {
    const statements = sqlCode("supabase/migrations/0178_ai_kling_provider.sql");
    expect(statements).not.toMatch(/rename/i);
    expect(statements).not.toMatch(/drop\s+(index|column)/i);
    expect(statements).not.toMatch(/replicate_prediction_id/);
    // every statement is a CHECK constraint on the provider column, and nothing else
    for (const line of statements.split(";").map((s) => s.trim()).filter(Boolean)) {
      expect(line, line.slice(0, 80)).toMatch(/provider_chk/);
    }
    // ...and the prose says WHY the column keeps its misleading name, so the next reader does not "tidy" it
    expect(src("supabase/migrations/0178_ai_kling_provider.sql")).toContain("replicate_prediction_id");
  });

  it("🔴 the Kling adapter supports EXACTLY the three verified video features (Part 5 §1)", async () => {
    const { klingProvider } = await import("./provider");
    // The three proven by a completed generation each.
    for (const feature of ["ai_text_to_video", "ai_image_to_video", "ai_lip_sync"] as const) {
      expect(klingProvider.supports(feature), feature).toBe(true);
    }
    /*
      🔴 And nothing else. Character Replace especially: the direct API has no
      endpoint that takes a video plus a character, so §37 says it stays
      unsupported rather than being approximated here.
    */
    for (const feature of ["ai_character_replace", "ai_text_to_audio", "ai_voice_clone", "ai_clean", "ai_generate"] as const) {
      expect(klingProvider.supports(feature), feature).toBe(false);
    }
    expect(klingProvider.id).toBe("kling");
    await expect(klingProvider.submit({} as never)).rejects.toThrow();
    // a vendor with no verifiable cancel endpoint says so rather than pretending
    await expect(klingProvider.cancel("task_1")).resolves.toBe(false);
    await expect(klingProvider.parseWebhook(new Headers(), "{}")).resolves.toBeNull();
  });

  it("🔴 no feature's routing resolves to the direct Kling seam — still Replicate or fal.ai only", () => {
    const resolve = code("lib/ai/providers/resolve.ts");
    /*
      The two route resolvers may (and do) mention Kling MODELS — that is the
      fal.ai adapter, live since 2026-09-21. What they must not do is name the
      new PROVIDER VALUE or reach for the direct client.
    */
    const routes = resolve.slice(resolve.indexOf("export function resolveReplacementRoute"), resolve.indexOf("export function vendorConfigured"));
    expect(routes).not.toContain('"kling"');
    expect(routes).not.toContain(DIRECT_SEAM_PATH);
    expect(routes).not.toContain("klingConfigured");

    const providersConfig = code("lib/ai/providers/config.ts");
    // kling is a vendor NAME only: never switchable, never a model key
    expect(providersConfig).toContain('export type SwitchableVendor = "replicate" | "fal"');
    expect(providersConfig).toContain('export const SWITCHABLE_VENDORS: readonly SwitchableVendor[] = ["replicate", "fal"]');
    expect(providersConfig).not.toMatch(/MODEL_KEYS[^;]*kling/);
    // ...and it appears in no feature's `vendors` list
    const defs = providersConfig.slice(providersConfig.indexOf("export const PROVIDER_FEATURE_DEFS"), providersConfig.indexOf("export function providerFeatureDef"));
    expect(defs).not.toContain('"kling"');
  });

  it("🔴 the Kling task id uses the existing provider-neutral column — no second idempotency mechanism", () => {
    // the webhook route hands a state to the SHARED handler, which matches on the unique reference column
    const route = code("app/api/webhooks/kling/route.ts");
    expect(route).toContain("handleProviderCallback");
    expect(route).toContain('provider: "kling"');
    // and it does not go near the job store, the finalizer, the notifier or the money
    for (const forbidden of ["transitionJob", "claimAiNotification", "sendSmartPush", "releaseJobFunding", "reserve_product_charge", "settle_product_charge"]) {
      expect(route, forbidden).not.toContain(forbidden);
    }
  });

  it("🔴 the client is server-only and is the single reader of every Kling credential", () => {
    const client = src("lib/ai/kling/client.ts");
    expect(client.startsWith('import "server-only";')).toBe(true);
    const all = ["config", "signature", "status", "provider"].map((f) => src(`lib/ai/kling/${f}.ts`)).join("\n");
    for (const secret of ["KLING_API_KEY", "KLING_ACCESS_KEY", "KLING_SECRET_KEY"]) {
      expect(client, secret).toContain(secret);
      expect(all, secret).not.toContain(`process.env.${secret}`);
    }
    // the webhook secret is read by the ROUTE (it has the raw body); nowhere else
    expect(src("app/api/webhooks/kling/route.ts")).toContain("process.env.KLING_WEBHOOK_SECRET");
  });

  it("🔴 no Kling credential reaches the worker — the boundary the Part 1 audit protects (§7)", () => {
    /*
      The worker legitimately imports the fal-era Kling INPUT limits
      (KLING_O1_EDIT_LIMITS) during prepare. What it must never hold is a
      credential, or an import of the direct client that reads one.
    */
    const workerFiles = ["server/services/ai-acquire-service.ts", "server/services/ai-character-replace-prepare-service.ts", "server/services/ai-lip-sync-prepare-service.ts", "server/services/ai-finalize-service.ts", "server/services/ai-character-replace-finalize-service.ts", "server/services/ai-character-replace-advance-service.ts", "server/services/ai-preflight-service.ts", "server/services/ai-audio-prepare.ts"];
    const worker = workerFiles.map((p) => src(p)).join("\n");
    for (const credential of KLING_CREDENTIALS) expect(worker, credential).not.toContain(credential);
    expect(worker).not.toContain(DIRECT_SEAM_PATH);
    // the worker still asks the FRONTEND to submit — the hop that keeps the credential on one host
    expect(src("server/services/ai-character-replace-prepare-service.ts")).toContain("dispatchProviderSubmit");
  });

  it("🔴 the seam talks to Kling directly — no aggregator name appears in it", () => {
    const all = ["config", "client", "signature", "status", "provider"].map((f) => code(`lib/ai/kling/${f}.ts`)).join("\n");
    for (const aggregator of ["replicate.com", "fal.run", "fal.ai", "kie.ai", "piapi", "pollo", "klingapi.com", "segmind", "aimlapi"]) {
      expect(all.toLowerCase(), aggregator).not.toContain(aggregator);
    }
  });
});
