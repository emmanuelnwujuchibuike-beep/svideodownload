import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { normalizeCharacterReplaceConfig } from "./config";
import { buildPrepareArgs, isKnownPrepareArg, PREPARE_CONSTANT_ARGS, secondsArg } from "./ffmpeg";
import { durationWithinTolerance, readCharacterReplaceMeta, selectedRangeOf } from "./job-meta";
import { buildWanAnimateReplaceInput, isTrustedProviderOutputUrl, WAN_ANIMATE_REPLACE, WAN_INPUT_FIELDS, wanResolutionFor } from "./model";
import { quoteCharacterReplace } from "./pricing";
import { createCharacterReplaceJobSchema, startCharacterReplaceJobSchema } from "./start-schema";
import { aiCharacterKey, aiPreparedKey, aiResultKey, aiSourceKey, pathBelongsTo } from "../storage";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 4 — the pipeline's pure pieces, and the wiring that must not drift
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §35's list, for everything that is a function of its inputs: the provider
 * payload, the ffmpeg plan, the metadata contract, the request shapes, the
 * quote hand-back, the storage keys. The database halves (atomic reserve,
 * refund-once, the compare-and-set transitions) are the same SQL functions
 * Part 3 probed live; the routes that call them are checked here for the
 * one thing a unit test CAN see — that every refund path goes through the
 * one idempotent function.
 */

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ───────────────────────────── provider payload (§36) ───────────────────── */

describe("Wan 2.2 Animate Replace — the payload", () => {
  it("is exactly the five documented fields, from validated values", () => {
    const input = buildWanAnimateReplaceInput({
      videoUrl: "https://x.supabase.co/storage/v1/object/sign/frenz-ai-source/u/f/j/prepared.mp4?token=a",
      characterImageUrl: "https://x.supabase.co/storage/v1/object/sign/frenz-ai-source/u/f/j/character.jpg?token=b",
      resolution: "480",
      goFast: false,
      mergeAudio: true,
    });
    expect(Object.keys(input).sort()).toEqual([...WAN_INPUT_FIELDS].sort());
    expect(input.resolution).toBe("480");
    expect(input.merge_audio).toBe(true);
    expect(input.go_fast).toBe(false);
    // the deprecated fields are never sent
    expect("frames_per_second" in input).toBe(false);
    expect("refert_num" in input).toBe(false);
    expect("seed" in input).toBe(false);
  });

  it("names the official model and a pinned version", () => {
    expect(WAN_ANIMATE_REPLACE.model).toBe("wan-video/wan-2.2-animate-replace");
    expect(WAN_ANIMATE_REPLACE.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps 480p/720p and REFUSES 1080p rather than downgrading it (§7)", () => {
    expect(wanResolutionFor("480p")).toBe("480");
    expect(wanResolutionFor("720p")).toBe("720");
    expect(wanResolutionFor("1080p")).toBeNull();
  });

  it("follows a recorded output only to Replicate's delivery hosts (SSRF)", () => {
    expect(isTrustedProviderOutputUrl("https://replicate.delivery/xezq/abc/output.mp4")).toBe(true);
    expect(isTrustedProviderOutputUrl("https://cdn.replicate.delivery/x.mp4")).toBe(true);
    expect(isTrustedProviderOutputUrl("http://replicate.delivery/x.mp4")).toBe(false);
    expect(isTrustedProviderOutputUrl("https://replicate.delivery.evil.com/x.mp4")).toBe(false);
    expect(isTrustedProviderOutputUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isTrustedProviderOutputUrl("file:///etc/passwd")).toBe(false);
  });

  it("refuses non-https media urls", () => {
    expect(() =>
      buildWanAnimateReplaceInput({ videoUrl: "http://evil/x.mp4", characterImageUrl: "https://ok/x.jpg", resolution: "720", goFast: false, mergeAudio: false }),
    ).toThrow();
  });
});

/* ───────────────────────────── the ffmpeg plan (§5) ─────────────────────── */

describe("the prepare plan — trim on the frame, nothing foreign in the array", () => {
  const plan = { input: "/tmp/frenz-ai-cr/abc/source.bin", output: "/tmp/frenz-ai-cr/abc/prepared.mp4", startMs: 15_000, endMs: 27_000 };

  it("cuts 15s→27s as -ss 15.000 … -t 12.000 and re-encodes to a faststart mp4", () => {
    const args = buildPrepareArgs(plan);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "15.000"]);
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "12.000"]);
    expect(args).toContain("libx264");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe(plan.output);
  });

  it("every element is a known constant, one of the two paths, or a formatted time", () => {
    for (const p of [plan, { ...plan, startMs: 0, endMs: null }, { ...plan, startMs: 0, endMs: 5_000 }]) {
      for (const arg of buildPrepareArgs(p)) expect(isKnownPrepareArg(arg, p), arg).toBe(true);
    }
  });

  it("a whole-video plan has no seek and no duration", () => {
    const args = buildPrepareArgs({ ...plan, startMs: 0, endMs: null });
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
  });

  it("refuses an empty range and a non-integer time", () => {
    expect(() => buildPrepareArgs({ ...plan, startMs: 5_000, endMs: 5_000 })).toThrow();
    expect(() => secondsArg(1.5)).toThrow();
    expect(secondsArg(0)).toBe("0.000");
    expect(secondsArg(27_000)).toBe("27.000");
  });

  it("the constant set carries no filename-like value a member could have typed", () => {
    for (const c of PREPARE_CONSTANT_ARGS) expect(c).not.toMatch(/\.(mp4|mov|webm|jpg)$/i);
  });

  /*
    ── 🔴 PURELY NATURAL (owner, 2026-09-14) ──────────────────────────────
    "The result and filter should be purely natural from replicate." The
    prepared file is the trim and the size and nothing else: no tone-map, no
    colour tags, no colour-space conversion. This test is the guard.
  */
  it("the model's input is the trim and the size only — no tone-map, no colour tags, no filter", () => {
    const args = buildPrepareArgs(plan);
    const vf = args[args.indexOf("-vf") + 1] ?? "";
    expect(vf.startsWith("scale=")).toBe(true);
    expect(vf).not.toMatch(/zscale|tonemap|eq=|lut|colorspace|format=gbrp/);
    for (const flag of ["-color_primaries", "-color_trc", "-colorspace", "-color_range", "-bsf:v"]) expect(args).not.toContain(flag);
    expect(args.filter((a) => a === "-vf")).toHaveLength(1);
    for (const arg of args) expect(isKnownPrepareArg(arg, plan), arg).toBe(true);
  });

  it("no saturation, brightness, LUT, tone-map or colour-tag code exists anywhere in the plan module", () => {
    const text = readFileSync(join(process.cwd(), "lib/ai/character-replace/ffmpeg.ts"), "utf8");
    expect(text).not.toMatch(/eq=saturation/);
    expect(text).not.toMatch(/lut3d|vibrance|unsharp/);
    expect(text).not.toMatch(/HDR_TO_SDR|tonemap=|h264_metadata|hevc_metadata|COLOR_TAG/);
  });
});

/* ───────────────────────────── the metadata contract ────────────────────── */

describe("the job's metadata contract", () => {
  const base = {
    tool: "character_replace",
    attempt: 1,
    character: { path: "u/f/j/character.jpg", mime: "image/jpeg", size: 1000, width: 800, height: 1000 },
    video: { path: "u/f/j/source.mp4", mime: "video/mp4", size: 100000, durationMs: 60_000, width: 1080, height: 1920, hasAudio: true },
    trim: { startMs: 15_000, endMs: 27_000 },
    settings: { quality: "720p", voiceMode: "original", lipSyncMode: null },
    quote: null,
    prepared: null,
    provider: null,
  };

  it("parses the shape the create route writes, and tolerates diagnostic keys", () => {
    const meta = readCharacterReplaceMeta({ ...base, finalize_from: "webhook", noted_at: "x" });
    expect(meta?.tool).toBe("character_replace");
    expect(meta?.trim?.endMs).toBe(27_000);
  });

  it("is null for another tool's row and for a half-written row", () => {
    expect(readCharacterReplaceMeta({ source_name: "clip.mp4" })).toBeNull();
    expect(readCharacterReplaceMeta({ ...base, video: undefined })).toBeNull();
  });

  it("the kept range is the trim, clamped to the real duration", () => {
    expect(selectedRangeOf(base)).toEqual({ startMs: 15_000, endMs: 27_000, durationMs: 12_000 });
    expect(selectedRangeOf({ ...base, trim: null })).toEqual({ startMs: 0, endMs: 60_000, durationMs: 60_000 });
    expect(selectedRangeOf({ ...base, video: { ...base.video, durationMs: 20_000 } })).toEqual({ startMs: 15_000, endMs: 20_000, durationMs: 5_000 });
  });

  it("billed vs actual: half a second or 3%, whichever is larger", () => {
    expect(durationWithinTolerance(12_000, 12_400)).toBe(true);
    expect(durationWithinTolerance(12_000, 12_600)).toBe(false);
    expect(durationWithinTolerance(60_000, 61_700)).toBe(true);
    expect(durationWithinTolerance(60_000, 62_000)).toBe(false);
    expect(durationWithinTolerance(12_000, 4_000)).toBe(false);
  });
});

/* ───────────────────────────── the request shapes ───────────────────────── */

describe("create/start request shapes — a configuration, never a price", () => {
  const create = {
    clientRequestId: "abcdefgh12345678",
    photo: { name: "me.jpg", mimeType: "image/jpeg", size: 100_000, width: 800, height: 1000 },
    video: { name: "clip.mp4", mimeType: "video/mp4", size: 5_000_000, durationMs: 18_400, width: 1080, height: 1920, hasAudio: true },
  };
  const start = {
    quote: { id: "sig_xxxxxxxxxxxxxxxxxxxx", product: "character_replace", currency: "NGN", pricingConfigVersion: 3, durationMs: 12_000, quality: "480p", voiceMode: "original", lipSyncMode: null, totalCents: 276, expiresAt: "2026-09-14T10:00:00.000Z" },
    trim: { startMs: 15_000, endMs: 27_000 },
    consent: true,
  };

  it("accepts the two honest bodies", () => {
    expect(createCharacterReplaceJobSchema.safeParse(create).success).toBe(true);
    expect(startCharacterReplaceJobSchema.safeParse(start).success).toBe(true);
    expect(startCharacterReplaceJobSchema.safeParse({ ...start, trim: null }).success).toBe(true);
  });

  it.each([
    ["price on create", { ...create, price: 1 }],
    ["balance on create", { ...create, balanceCents: 1 }],
    ["a storage path on create", { ...create, video: { ...create.video, path: "x/y/z" } }],
    ["an amount on start", { ...start, amountCents: 1 }],
    ["a balance on start", { ...start, balanceCents: 9 }],
    ["an unsigned field inside the quote", { ...start, quote: { ...start.quote, videoCents: 1 } }],
    ["consent false", { ...start, consent: false }],
    ["consent missing", { quote: start.quote, trim: null }],
    ["a quote for another product", { ...start, quote: { ...start.quote, product: "ai_clean" } }],
  ])("refuses %s", (_label, body) => {
    const schema = "photo" in body ? createCharacterReplaceJobSchema : startCharacterReplaceJobSchema;
    expect(schema.safeParse(body).success).toBe(false);
  });
});

/* ───────────────────────────── the quote hand-back (§11) ────────────────── */

describe("verifyStartQuote — genuine, fresh, current", () => {
  let verifyStartQuote: typeof import("./start-verify").verifyStartQuote;
  let signQuote: typeof import("./wallet").signQuote;
  const config = normalizeCharacterReplaceConfig(null);
  const money = { currency: "NGN", symbol: "₦" };
  const input = { selectedDurationMs: 12_000, quality: "480p" as const, voiceMode: "original" as const, lipSyncMode: null };

  beforeAll(async () => {
    process.env.AI_QUOTE_SIGNING_SECRET = "test-signing-key";
    ({ verifyStartQuote } = await import("./start-verify"));
    ({ signQuote } = await import("./wallet"));
  });

  const issued = () => {
    const q = quoteCharacterReplace(input, config, money);
    q.id = signQuote(q);
    return q;
  };
  const bodyOf = (q: ReturnType<typeof issued>, trim: { startMs: number; endMs: number } | null = { startMs: 15_000, endMs: 27_000 }) => ({
    quote: { id: q.id, product: "character_replace" as const, currency: q.currency, pricingConfigVersion: q.pricingConfigVersion, durationMs: q.durationMs, quality: q.quality, voiceMode: q.voiceMode, lipSyncMode: q.lipSyncMode, totalCents: q.totalCents, expiresAt: q.expiresAt },
    trim,
    consent: true as const,
  });

  it("accepts the server's own quote and hands back the recomputed snapshot with its id", () => {
    const q = issued();
    const v = verifyStartQuote(bodyOf(q), config, money);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.snapshot.id).toBe(q.id);
      expect(v.snapshot.totalCents).toBe(q.totalCents);
      expect(v.snapshot.durationMs).toBe(12_000);
    }
  });

  it("refuses an edited total — the signature no longer matches", () => {
    const q = issued();
    const body = bodyOf(q);
    body.quote.totalCents = 1;
    const v = verifyStartQuote(body, config, money);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("INVALID_INPUT");
  });

  it("refuses an edited duration (duration manipulation)", () => {
    const q = issued();
    const body = bodyOf(q, { startMs: 0, endMs: 60_000 });
    body.quote.durationMs = 60_000; // more video for the same money
    const v = verifyStartQuote(body, config, money);
    expect(v.ok).toBe(false);
  });

  it("refuses a trim that is not the priced range", () => {
    const q = issued();
    const v = verifyStartQuote(bodyOf(q, { startMs: 0, endMs: 30_000 }), config, money);
    expect(v.ok).toBe(false);
  });

  it("refuses an expired quote", () => {
    const q = issued();
    const v = verifyStartQuote(bodyOf(q), config, { ...money, now: new Date(Date.now() + 11 * 60_000) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("QUOTE_EXPIRED");
  });

  it("refuses a genuine quote once the operator changed the price (PRICE_CHANGED, never a silent re-price)", () => {
    const q = issued();
    const dearer = normalizeCharacterReplaceConfig({ ...(config as unknown as Record<string, unknown>), pricePerSecondCents: config.pricePerSecondCents + 10, pricingVersion: config.pricingVersion + 1 });
    const v = verifyStartQuote(bodyOf(q), dearer, money);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("PRICE_CHANGED");
  });

  it("refuses a quality the operator has switched off (unsupported quality)", () => {
    const q = issued();
    const off = normalizeCharacterReplaceConfig({
      ...(config as unknown as Record<string, unknown>),
      qualities: config.qualities.map((x) => ({ ...x, enabled: x.id !== "480p" })),
    });
    const v = verifyStartQuote(bodyOf(q), off, money);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("QUALITY_UNAVAILABLE");
  });

  it("refuses a quote signed with another key (forgery)", () => {
    const q = issued();
    q.id = "not-the-servers-signature-xxxxxxxxx";
    expect(verifyStartQuote(bodyOf(q), config, money).ok).toBe(false);
  });
});

/* ───────────────────────────── storage keys (§20) ───────────────────────── */

describe("storage keys — every object of a job sits under the owner's folder", () => {
  const u = "bb520a2e-4457-472e-bc7a-455d2547e85e";
  const j = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
  it("source, character, prepared and result all pass the ownership check for the owner and fail for anyone else", () => {
    for (const key of [aiSourceKey(u, "ai_character_replace", j, "mp4"), aiCharacterKey(u, "ai_character_replace", j, "jpg"), aiPreparedKey(u, "ai_character_replace", j), aiResultKey(u, "ai_character_replace", j, "mp4")]) {
      expect(pathBelongsTo(key, u, j)).toBe(true);
      expect(pathBelongsTo(key, "11111111-2222-3333-4444-555555555555", j)).toBe(false);
      expect(pathBelongsTo(key, u, "99999999-2222-3333-4444-555555555555")).toBe(false);
    }
  });
});

/* ───────────────────────────── the refund wiring ────────────────────────── */

describe("every path that undoes a Character Replace job refunds through the ONE idempotent function", () => {
  it("funding routes ai_character_replace to refundCharacterReplaceCharge", () => {
    const src = read("lib/ai/funding.ts");
    expect(src).toMatch(/feature === "ai_character_replace"[\s\S]*refundCharacterReplaceCharge\(/);
  });

  it.each([
    "lib/ai/character-replace/start-job.ts",
    "lib/ai/character-replace/queue.ts",
    "lib/ai/webhook-handler.ts",
    "app/api/ai/jobs/[id]/cancel/route.ts",
    "lib/ai/reconcile.ts",
    "lib/ai/stall-server.ts",
    "server/services/ai-character-replace-prepare-service.ts",
    "server/services/ai-character-replace-finalize-service.ts",
  ])("%s calls releaseJobFunding and never the product refund directly", (file) => {
    const src = read(file);
    expect(src).toContain("releaseJobFunding(");
    expect(src).not.toContain("refundCharacterReplaceCharge(");
  });

  it("the provider token never reaches a client module or a response", () => {
    for (const file of ["lib/ai/character-replace/client.ts", "features/ai/character-replace/use-character-replace-workspace.ts", "features/ai/character-replace/character-replace-workspace.tsx"]) {
      expect(read(file)).not.toContain("REPLICATE_API_TOKEN");
    }
    expect(read("lib/ai/jobs.ts")).not.toMatch(/replicate_prediction_id[^\n]*\n[^\n]*characterReplace/);
  });

  it("the old /start route refuses Character Replace jobs (its funding path is the retired wallet)", () => {
    expect(read("app/api/ai/jobs/[id]/start/route.ts")).toContain('feature.id === "ai_character_replace"');
  });
});
