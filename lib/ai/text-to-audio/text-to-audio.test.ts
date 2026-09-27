import { CHARACTER_REPLACE_DEFAULTS, CHARACTER_REPLACE_DEFAULT_LANGUAGES } from "@/lib/ai/character-replace/config";
import { buildElevenLabsTtsBody } from "@/lib/ai/voice/elevenlabs";
import { elevenLabsTtsModel } from "@/lib/ai/voice/elevenlabs-models";
import { resolveTextToAudioRoute, textToAudioVoices } from "@/lib/ai/text-to-audio/route";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { aiFeature, isWalletFundedFeature, jobToView, toolIdFor, type AiJobRow } from "@/lib/ai/jobs";
import { normalizeTextToAudioConfig, publicTextToAudioConfig, TEXT_TO_AUDIO_DEFAULTS, TEXT_TO_AUDIO_MODEL_IDS, versionTextToAudioConfig, activeTextToAudioModel, type TextToAudioConfig } from "@/lib/ai/text-to-audio/config";
import { defaultAudioName, readTextToAudioMeta } from "@/lib/ai/text-to-audio/job-meta";
import { mp3Facts, parseMp3FrameHeader } from "@/lib/ai/text-to-audio/mp3-duration";
import { countTextToAudioCharacters, publicTextToAudioQuote, quoteTextToAudio, textToAudioMonthKey } from "@/lib/ai/text-to-audio/pricing";
import { createTextToAudioJobSchema, textToAudioQuoteRequestSchema } from "@/lib/ai/text-to-audio/schemas";
import { lipSyncSpeechInput } from "@/lib/ai/lip-sync/schemas";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the standalone tool (the owner's brief, 2026-09-21)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What these pin: the tool is a first-class feature of the one job system;
 * its money is its own (characters × price, the quality multiplier, the
 * minimum, and 500 free characters a month before any of it); the free
 * allowance is never double-counted and never leaves a charge behind; the
 * contract that reaches a browser names no vendor or model; a saved audio
 * can be reused in Lip Sync Pro without paying for the audio again; and the
 * MP3 the finalizer stores is measured, not guessed.
 */
const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** The file without its comment lines — the prose says what a tool does NOT do; only the CODE may be pinned against it. */
const codeOf = (path: string) =>
  src(path)
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join("\n");

const money = { currency: "NGN" };
const cfg = (patch: Partial<TextToAudioConfig> = {}): TextToAudioConfig => normalizeTextToAudioConfig({ ...TEXT_TO_AUDIO_DEFAULTS, ...patch });

describe("the feature is part of the one job system (§9)", () => {
  it("is registered, wallet-funded, and carries its own tool id", () => {
    const feature = aiFeature("ai_text_to_audio");
    expect(feature?.label).toBe("Text to Audio");
    expect(isWalletFundedFeature("ai_text_to_audio")).toBe(true);
    expect(toolIdFor({ feature: "ai_text_to_audio" })).toBe("text_to_audio");
    expect(toolIdFor({ feature: "ai_lip_sync" })).toBe("lip_sync");
    expect(toolIdFor({ feature: "ai_character_replace", metadata: { mode: "face_only" } })).toBe("face_replace");
    expect(toolIdFor({ feature: "ai_character_replace", metadata: { mode: "skin_face" } })).toBe("face_skin_replace");
    expect(toolIdFor({ feature: "ai_character_replace", metadata: {} })).toBe("character_replace");
  });
  it("migration 0170 creates the two tables and widens the feature check LAST", () => {
    const sql = src("supabase/migrations/0170_text_to_audio_and_audio_library.sql");
    expect(sql).toContain("create table if not exists public.ai_audio_assets");
    expect(sql).toContain("create table if not exists public.ai_tta_free_usage");
    // the 0167 lock lesson: the ai_jobs constraint is the last statement, not valid + validate
    expect(sql.indexOf("ai_jobs_feature_chk")).toBeGreaterThan(sql.indexOf("create table if not exists public.ai_tta_free_usage"));
    expect(sql).toContain(") not valid;");
    expect(sql).toContain("validate constraint ai_jobs_feature_chk");
    // a security-definer function with a p_user_id argument must never be executable by a browser
    expect(sql).toContain("revoke all on function public.consume_tta_free_characters(uuid, text, integer, integer) from public, anon, authenticated;");
    expect(sql).toContain("revoke all on function public.release_tta_free_characters(uuid, text, integer) from public, anon, authenticated;");
  });
  it("both new tables are in the two catalogues (the standing rule)", () => {
    expect(src("lib/platform/data-domains.ts")).toContain('"ai_audio_assets", "ai_tta_free_usage"');
    const portability = src("lib/portability/tables.ts");
    expect(portability).toContain('ai_audio_assets: "user_id"');
    expect(portability).toContain('ai_tta_free_usage: "user_id"');
  });
});

describe("the configuration and the admin switch", () => {
  it("defaults to the DIRECT ElevenLabs API and 500 free characters a month", () => {
    const c = cfg();
    expect(c.route).toBe("elevenlabs");
    expect(activeTextToAudioModel(c)).toBe("elevenlabs/eleven_v3");
    expect(c.freeCharactersPerMonth).toBe(500);
  });
  it("accepts only the model ids its route offers, and keeps the current one otherwise", () => {
    const replicate = normalizeTextToAudioConfig({ route: "replicate", models: { replicate: { model: "elevenlabs/turbo-v2.5" } } });
    expect(replicate.models.replicate.model).toBe("elevenlabs/turbo-v2.5");
    const nonsense = normalizeTextToAudioConfig({ models: { elevenlabs: { model: "openai/whatever" } } });
    expect(nonsense.models.elevenlabs.model).toBe(TEXT_TO_AUDIO_DEFAULTS.models.elevenlabs.model);
    // a direct-API id is not a Replicate id and the other way round
    expect(TEXT_TO_AUDIO_MODEL_IDS.replicate).not.toContain("elevenlabs/eleven_v3");
    expect(TEXT_TO_AUDIO_MODEL_IDS.elevenlabs).not.toContain("elevenlabs/v3");
  });
  it("versions on a real change and not on a re-save (key order cannot bump it)", () => {
    const before = cfg();
    const unchanged = versionTextToAudioConfig(before, normalizeTextToAudioConfig(JSON.parse(JSON.stringify({ models: before.models, route: before.route, enabled: before.enabled, freeCharactersPerMonth: before.freeCharactersPerMonth, minimumCharacters: before.minimumCharacters, maximumCharacters: before.maximumCharacters, voiceIds: before.voiceIds, languageCodes: before.languageCodes, libraryRetentionDays: before.libraryRetentionDays, minimumChargeCents: before.minimumChargeCents, pricingVersion: before.pricingVersion, version: before.version }))));
    expect(unchanged.version).toBe(before.version);
    expect(unchanged.pricingVersion).toBe(before.pricingVersion);
    const priced = versionTextToAudioConfig(before, cfg({ minimumChargeCents: 500 }));
    expect(priced.pricingVersion).toBe(before.pricingVersion + 1);
    expect(priced.version).toBe(before.version + 1);
    const routed = versionTextToAudioConfig(before, cfg({ route: "replicate" }));
    expect(routed.version).toBe(before.version + 1);
    expect(routed.pricingVersion).toBe(before.pricingVersion);
  });
  it("the public configuration names no vendor, route or model", () => {
    const pub = publicTextToAudioConfig(cfg(), { code: "NGN", symbol: "₦" }, true);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/replicate|elevenlabs|eleven_v3/i);
    expect(pub.freeCharactersPerMonth).toBe(500);
    expect(pub.priceLine).toMatch(/per character/);
  });
});

describe("the price of one generation (§2)", () => {
  it("charges only what the free allowance does not cover", () => {
    const c = cfg();
    const q = quoteTextToAudio({ characters: 800, freeCharactersAvailable: 500 }, c, money);
    expect(q.freeCharactersCovered).toBe(500);
    expect(q.billableCharacters).toBe(300);
    // 300 × 0.5 = 150 minor units
    expect(q.totalCents).toBe(150);
    expect(q.lines.find((l) => l.key === "free")?.characters).toBe(500);
  });
  it("a generation the allowance covers in full is FREE — the minimum charge never applies to it", () => {
    const c = cfg({ minimumChargeCents: 200 });
    const q = quoteTextToAudio({ characters: 120, freeCharactersAvailable: 500 }, c, money);
    expect(q.billableCharacters).toBe(0);
    expect(q.totalCents).toBe(0);
    expect(q.lines.some((l) => l.key === "minimum")).toBe(false);
  });
  it("the minimum applies to a billable one, and the quality multiplier scales the characters", () => {
    const c = cfg({ minimumChargeCents: 500, freeCharactersPerMonth: 0 });
    const cheap = quoteTextToAudio({ characters: 10, freeCharactersAvailable: 0 }, c, money);
    expect(cheap.totalCents).toBe(500);
    const doubled = normalizeTextToAudioConfig({ ...TEXT_TO_AUDIO_DEFAULTS, freeCharactersPerMonth: 0, models: { ...TEXT_TO_AUDIO_DEFAULTS.models, elevenlabs: { ...TEXT_TO_AUDIO_DEFAULTS.models.elevenlabs, qualityMultiplier: 2 } } });
    expect(quoteTextToAudio({ characters: 100, freeCharactersAvailable: 0 }, doubled, money).totalCents).toBe(100);
  });
  it("the quote that leaves the server carries no route, model or provider cost", () => {
    const q = quoteTextToAudio({ characters: 900, freeCharactersAvailable: 100 }, cfg(), money);
    const shown = publicTextToAudioQuote(q) as Record<string, unknown>;
    expect(shown.route).toBeUndefined();
    expect(shown.model).toBeUndefined();
    expect(shown.providerCostEstimateUsdCents).toBeUndefined();
    expect(JSON.stringify(shown)).not.toMatch(/eleven|replicate/i);
  });
  it("counts characters as the trimmed text's length and keys the month in the operator's zone", () => {
    expect(countTextToAudioCharacters("  hello  ")).toBe(5);
    // 2026-01-01 00:30 UTC is still 2025-12-31 in New York, and already 2026-01-01 in Lagos
    const newYear = new Date("2026-01-01T00:30:00Z");
    expect(textToAudioMonthKey(newYear, "Africa/Lagos")).toBe("2026-01");
    expect(textToAudioMonthKey(newYear, "America/New_York")).toBe("2025-12");
    expect(textToAudioMonthKey(newYear, "Not/AZone")).toBe("2026-01");
  });
});

describe("the contract on the row, and what a member may see", () => {
  const row = (metadata: Record<string, unknown>, patch: Partial<AiJobRow> = {}): AiJobRow =>
    ({
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "u1",
      guest_id: null,
      batch_id: null,
      batch_index: null,
      feature: "ai_text_to_audio",
      provider: "replicate",
      model: null,
      model_version: null,
      status: "completed",
      client_request_id: null,
      source_path: null,
      result_path: "u1/ai_text_to_audio/j/result.mp3",
      poster_path: null,
      funding_source: "balance",
      charged_cents: 150,
      source_size: null,
      result_size: 40_000,
      result_duration: 12,
      result_mime_type: "audio/mpeg",
      audio_restored: null,
      source_duration: null,
      source_mime_type: null,
      source_kind: "upload",
      source_url: null,
      replicate_prediction_id: null,
      error_code: null,
      error_message: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      expires_at: null,
      notified_at: null,
      finalize_attempts: 0,
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
      metadata,
      ...patch,
    }) as AiJobRow;

  const meta = {
    tool: "text_to_audio",
    tool_id: "text_to_audio",
    text: "Say this out loud please",
    characters: 24,
    name: "Intro voiceover",
    voiceId: "aria",
    providerVoiceId: "21m00Tcm4TlvDq8ikWAM",
    languageCode: "en",
    route: "elevenlabs",
    model: "elevenlabs/eleven_v3",
    quote: { totalCents: 150, currency: "NGN", characters: 24, freeCharactersCovered: 0 },
    billing: { type: "PAID", normalPriceCents: 150, chargedCents: 150, currency: "NGN" },
    free_characters: { monthKey: "2026-09", covered: 0 },
    output: { durationMs: 12_000, bytes: 40_000, mime: "audio/mpeg" },
    asset_id: "22222222-2222-4222-8222-222222222222",
  };

  it("parses a complete row and refuses one that is not this tool's", () => {
    expect(readTextToAudioMeta(meta)?.name).toBe("Intro voiceover");
    expect(readTextToAudioMeta({ ...meta, tool: "lip_sync" })).toBeNull();
    expect(readTextToAudioMeta(null)).toBeNull();
  });
  it("the view reports the LENGTH of the text and never the text, the path, the route or the model", () => {
    const view = jobToView(row(meta), () => "x");
    expect(view.textToAudio?.characters).toBe(24);
    expect(view.textToAudio?.name).toBe("Intro voiceover");
    expect(view.textToAudio?.assetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(view.textToAudio?.durationMs).toBe(12_000);
    const text = JSON.stringify(view);
    expect(text).not.toContain("Say this out loud");
    expect(text).not.toContain("21m00Tcm4TlvDq8ikWAM");
    expect(text).not.toMatch(/eleven_v3|elevenlabs|result\.mp3/);
  });
  it("a failed generation reports the refund of money OR of the free characters", () => {
    const freeRun = jobToView(row({ ...meta, billing: { type: "FREE_ALLOWANCE", normalPriceCents: 0, chargedCents: 0, currency: "NGN" }, free_characters: { monthKey: "2026-09", covered: 24 } }, { status: "failed", funding_source: "free", charged_cents: 0 }), () => "x");
    expect(freeRun.textToAudio?.billing).toBe("FREE_ALLOWANCE");
    expect(freeRun.textToAudio?.refunded).toBe(true);
    const paidRun = jobToView(row(meta, { status: "failed" }), () => "x");
    expect(paidRun.textToAudio?.refunded).toBe(true);
    // a job of another tool has no block at all
    expect(jobToView(row({ tool: "lip_sync" }, { feature: "ai_lip_sync" }), () => "x").textToAudio).toBeNull();
  });
  it("names an unnamed generation from its own words", () => {
    expect(defaultAudioName("  Welcome to Frenz, the fastest way to save what you love.  ")).toBe("Welcome to Frenz, the fastest way");
    expect(defaultAudioName("!!!", new Date("2026-09-21T00:00:00Z"))).toBe("Audio 2026-09-21");
  });
});

describe("the request bodies", () => {
  it("the create body is strict, and a name is optional", () => {
    expect(createTextToAudioJobSchema.safeParse({ clientRequestId: "abcdefgh", text: "hello" }).success).toBe(true);
    expect(createTextToAudioJobSchema.safeParse({ clientRequestId: "abcdefgh", text: "hello", nickname: "x" }).success).toBe(false);
    expect(createTextToAudioJobSchema.safeParse({ clientRequestId: "abcdefgh", text: "" }).success).toBe(false);
  });
  it("the quote body takes the text or only its length, and refuses neither", () => {
    expect(textToAudioQuoteRequestSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(textToAudioQuoteRequestSchema.safeParse({ characters: 42 }).success).toBe(true);
    expect(textToAudioQuoteRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("reusing a saved audio in Lip Sync Pro (§4) — never charged twice", () => {
  it("the speech union takes a library asset, and still refuses two sources or none", () => {
    expect(lipSyncSpeechInput.safeParse({ source: "library", assetId: "33333333-3333-4333-8333-333333333333" }).success).toBe(true);
    expect(lipSyncSpeechInput.safeParse({ source: "library", assetId: "not-a-uuid" }).success).toBe(false);
    expect(lipSyncSpeechInput.safeParse({ source: "library", assetId: "33333333-3333-4333-8333-333333333333", text: "both" }).success).toBe(false);
    expect(lipSyncSpeechInput.safeParse({}).success).toBe(false);
  });
  it("a library source is priced exactly as an uploaded one: the lip sync only, no TTS line", () => {
    const quote = src("app/api/ai/lip-sync/quote/route.ts");
    expect(quote).toContain('parsed.data.speechSource === "library" ? "audio" : parsed.data.speechSource');
    // the server copies the asset into the job's own folder and marks where it came from
    const open = src("lib/ai/lip-sync/open-job.ts");
    expect(open).toContain("copyLibraryAudioIntoJob");
    expect(open).toContain('origin: "library"');
    // no upload ticket is minted for a library audio — there is nothing for the member to upload
    expect(open).toContain('facts.speech.source === "audio" && !facts.library');
  });
});

describe("the MP3 the finalizer stores is measured, not guessed", () => {
  /** One valid MPEG-1 Layer III frame header: 128 kb/s, 44.1 kHz, no padding → 417 bytes, 1152 samples. */
  const frame = () => {
    const buf = Buffer.alloc(417);
    buf[0] = 0xff;
    buf[1] = 0xfb;
    buf[2] = 0x90;
    buf[3] = 0x00;
    return buf;
  };
  it("reads a frame header's length and sample count", () => {
    const f = parseMp3FrameHeader(frame(), 0);
    expect(f).toEqual({ length: 417, samples: 1152, sampleRate: 44100, bitrateKbps: 128 });
    expect(parseMp3FrameHeader(Buffer.from([0x00, 0x00, 0x00, 0x00]), 0)).toBeNull();
  });
  it("adds the frames up, skips a leading ID3v2 tag, and refuses what is not MPEG audio", () => {
    const id3 = Buffer.alloc(10 + 32);
    id3.write("ID3", 0, "ascii");
    id3[3] = 3;
    id3[9] = 32; // a 32-byte tag body
    const audio = Buffer.concat([id3, frame(), frame(), frame()]);
    const facts = mp3Facts(audio);
    expect(facts?.frames).toBe(3);
    // 3 × 1152 / 44100 = 78.4 ms
    expect(facts?.durationMs).toBe(78);
    expect(facts?.bitrateKbps).toBe(128);
    expect(mp3Facts(Buffer.from("this is not audio at all, not one frame in it"))).toBeNull();
  });
});

describe("the money and the free allowance are undone exactly once", () => {
  it("the undo releases the month's characters through the guarded helper, from every caller", () => {
    const funding = src("lib/ai/funding.ts");
    expect(funding).toContain('if (opts.feature === "ai_text_to_audio")');
    expect(funding).toContain("releaseFreeCharactersForJob");
    // the mark is claimed with a conditional update before the function runs
    const free = src("lib/ai/text-to-audio/free.ts");
    expect(free).toContain('.is("metadata->free_characters->>released", null)');
    expect(free).toContain("release_tta_free_characters");
  });
  it("Generate gives the characters back on every refusal after it took them", () => {
    const generate = src("lib/ai/text-to-audio/generate.ts");
    for (const reason of ["price moved", "credits required", "wallet off", "balance short", "balance read failed", "duplicate request"]) {
      expect(generate).toContain(`giveBack("${reason}")`);
    }
    // after the claim they come back through endUnclaimed, which calls giveBack and then ends the row
    expect(generate).toContain("const endUnclaimed = async (why: string) => {");
    expect(generate).toContain("await giveBack(why);");
    for (const reason of ["active limit", "daily limit", "global limit", "credits reservation refused", "wallet reservation refused"]) {
      expect(generate).toContain(`endUnclaimed("${reason}")`);
    }
    // the funding order of every paid AI tool: credits, then the wallet — and the claim before the reservation
    expect(generate.indexOf("await getAiCreditEntitlement(")).toBeLessThan(generate.indexOf("await getAiWalletBalanceCents("));
    expect(generate.indexOf("const claim = await claimJobStart(")).toBeLessThan(generate.indexOf("await reserveAiWalletCharge("));
  });
  it("the finalizer settles once, saves the library row before completing, and refuses a non-audio output", () => {
    const finalize = src("lib/ai/text-to-audio/finalize.ts");
    expect(finalize).toContain("claimFinalization");
    expect(finalize.indexOf("createAudioAsset")).toBeLessThan(finalize.indexOf('"completed"'));
    expect(finalize).toContain("output is not MPEG audio");
    expect(finalize).toContain("settleAiCredits");
    expect(finalize).toContain("settleAiWalletCharge");
    // a Text to Audio job finishes on the frontend — the worker is never asked
    expect(src("lib/ai/finalize-dispatch.ts")).toContain('row?.feature === "ai_text_to_audio"');
  });
});

describe("the tool never becomes a video pipeline (the brief's hard rule)", () => {
  it("nothing in the unit reaches a video model, a prepare service or the worker", () => {
    for (const file of ["lib/ai/text-to-audio/generate.ts", "lib/ai/text-to-audio/finalize.ts", "lib/ai/text-to-audio/assets.ts", "lib/ai/text-to-audio/pricing.ts"]) {
      expect(codeOf(file)).not.toMatch(/wan-video|kling|character-replace\/prepare|dispatchPreparation|submitLipSyncJob|runPrepare|ffmpeg/i);
    }
  });
  it("the workspace offers text, voice, a name and a price — and no upload at all", () => {
    const ws = src("features/ai/text-to-audio/text-to-audio-workspace.tsx");
    expect(ws).toContain("Turn your words into natural AI audio.");
    expect(ws).toContain("Use in Lip Sync Pro");
    expect(ws).not.toMatch(/type="file"|uploadSource|readVideoMetadata/);
  });
  it("the Explore grid carries the brief's one-liners, grouped, with no AI Clean", () => {
    const grid = src("features/ai/frenz-ai-tools-grid.tsx");
    expect(grid).toContain("Turn your words into natural AI audio.");
    expect(grid).toContain("Give an existing video natural lip synchronization using any audio.");
    expect(grid).toContain("Replace a face while preserving the rest of the video.");
    expect(grid).toContain("Replace the face and skin appearance.");
    expect(grid).toContain("Transform the complete character in your video.");
    expect(grid).toContain('audio: { title: "Audio tools"');
    // AI Clean is retired: no card, no id, no href — the only mention allowed is the comment that says so
    expect(codeOf("features/ai/frenz-ai-tools-grid.tsx")).not.toMatch(/ai[_ -]?clean/i);
  });
});

/**
 * ── PIDGIN, AND THE MODELS THAT DETECT THEIR OWN LANGUAGE (2026-09-27) ──────
 *
 * Owner: "I want the voice cloning to also have the accent and can speak all
 * languages including pidgin and all."
 *
 * The provider was never the blocker. v3 and Multilingual v2 refuse a
 * `language_code` parameter and read the language out of the TEXT, so the
 * picker was our catalogue, not their limit — and Pidgin was missing from it.
 *
 * Turbo and Flash v2.5 DO take the parameter, so they deliberately do not get
 * the extra codes: offering a language whose code the model would reject is how
 * a member gets a 422 for choosing something we showed them.
 */
describe("the languages a member may choose", () => {
  const catalogue = { ...CHARACTER_REPLACE_DEFAULTS, languages: CHARACTER_REPLACE_DEFAULT_LANGUAGES };

  it("Pidgin is in the catalogue, with a name a Nigerian member would recognise", () => {
    const row = CHARACTER_REPLACE_DEFAULT_LANGUAGES.find((l) => l.code === "pcm");
    expect(row).toBeTruthy();
    expect(row!.label).toBe("Nigerian Pidgin");
  });

  it("the auto-detecting models speak it; the ones that take a language code do not offer it", () => {
    expect(elevenLabsTtsModel("elevenlabs/eleven_v3")!.languages).toContain("pcm");
    // Multilingual v2 documents 29 languages and Pidgin is not among them — we do not claim what the vendor does not
    expect(elevenLabsTtsModel("elevenlabs/eleven_multilingual_v2")!.languages).not.toContain("pcm");
    // these two are sent `language_code`, so an unknown code would be a refusal
    expect(elevenLabsTtsModel("elevenlabs/eleven_turbo_v2_5")!.languages).not.toContain("pcm");
    expect(elevenLabsTtsModel("elevenlabs/eleven_flash_v2_5")!.languages).not.toContain("pcm");
  });

  it("and the code never travels to the API for a model that would refuse it", () => {
    const body = buildElevenLabsTtsBody({ text: "How far, you dey alright?", modelId: "eleven_v3", languageCode: "pcm", languageCodeParam: false });
    expect(body.language_code).toBeUndefined();
  });

  it("so Pidgin reaches the picker for the default route", () => {
    const config = { ...TEXT_TO_AUDIO_DEFAULTS, route: "elevenlabs" as const };
    const resolved = resolveTextToAudioRoute(config);
    const { languages } = textToAudioVoices(config, catalogue, resolved);
    expect(languages.map((l) => l.code)).toContain("pcm");
  });
});
