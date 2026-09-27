import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aiFeature, AI_FEATURES, canTransition, isWalletFundedFeature, toolIdFor } from "@/lib/ai/jobs";
import { aiVoiceSampleKey, pathBelongsTo, pathBelongsToOwner } from "@/lib/ai/storage";
import {
  normalizeVoiceCloneConfig,
  publicVoiceCloneConfig,
  VOICE_CLONE_CONSENT_STATEMENT,
  VOICE_CLONE_DEFAULTS,
  versionVoiceCloneConfig,
  voiceCloneFormatAllowed,
  voiceCloneSlotsFor,
} from "@/lib/ai/voice-clone/config";
import { readVoiceCloneDraft, readVoiceCloneMeta } from "@/lib/ai/voice-clone/job-meta";
import { publicVoiceCloneQuote, quoteVoiceClone, voiceCloneMonthKey } from "@/lib/ai/voice-clone/pricing";
import { createVoiceCloneJobSchema, startVoiceCloneJobSchema } from "@/lib/ai/voice-clone/schemas";
import { cloneIdFromVoiceId, isCloneVoiceId, voiceIdForClone } from "@/lib/ai/voice-clone/usable";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING (2026-09-27) — the rules that must not quietly change
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The owner: "next lets build the standalone voice cloning … all ai features
 * pipeline must be standalone to give a cleaner premium result rather than
 * making them all go through same pipeline."
 *
 * So the last group of tests is structural: this unit must not acquire a video
 * model, a prepare service or the worker. A test is the only thing that stops
 * that happening one convenient import at a time.
 */

describe("the configuration", () => {
  it("defaults are offerable: enabled, one free voice, a slot for a free member", () => {
    expect(VOICE_CLONE_DEFAULTS.enabled).toBe(true);
    expect(VOICE_CLONE_DEFAULTS.freeClonesPerMonth).toBe(1);
    expect(VOICE_CLONE_DEFAULTS.slots.free).toBeGreaterThan(0);
    expect(VOICE_CLONE_DEFAULTS.requireConsentName).toBe(true);
    expect(VOICE_CLONE_DEFAULTS.consentStatement).toBe(VOICE_CLONE_CONSENT_STATEMENT);
  });

  it("a junk row normalises to the defaults rather than to an unusable tool", () => {
    const c = normalizeVoiceCloneConfig({ enabled: "yes", perCloneCents: "abc", slots: { free: -5, pro: "x" }, samples: { formats: ["exe", "mp3"], minimum: 0 } });
    expect(c.enabled).toBe(VOICE_CLONE_DEFAULTS.enabled);
    expect(c.perCloneCents).toBe(VOICE_CLONE_DEFAULTS.perCloneCents);
    expect(c.slots.free).toBe(0);
    expect(c.slots.pro).toBe(VOICE_CLONE_DEFAULTS.slots.pro);
    // an unknown format is dropped, a known one kept
    expect(c.samples.formats).toEqual(["mp3"]);
  });

  it("an empty format list is read as the default set — a tool that takes no format is unusable", () => {
    expect(normalizeVoiceCloneConfig({ samples: { formats: [] } }).samples.formats).toEqual(VOICE_CLONE_DEFAULTS.samples.formats);
  });

  it("the maximum can never sit below the minimum, whichever order they were saved in", () => {
    const c = normalizeVoiceCloneConfig({ samples: { minimum: 5, maximum: 2, maximumBytes: 20 * 1024 * 1024, maximumTotalBytes: 1024 * 1024 } });
    expect(c.samples.maximum).toBeGreaterThanOrEqual(c.samples.minimum);
    expect(c.samples.maximumTotalBytes).toBeGreaterThanOrEqual(c.samples.maximumBytes);
  });

  it("the consent statement cannot be emptied — a blank confirmation is no confirmation", () => {
    expect(normalizeVoiceCloneConfig({ consentStatement: "   " }).consentStatement).toBe(VOICE_CLONE_DEFAULTS.consentStatement);
  });

  it("a price change bumps the pricing version; changing the consent wording bumps only the version", () => {
    const base = VOICE_CLONE_DEFAULTS;
    const priced = versionVoiceCloneConfig(base, { ...base, perCloneCents: 500 });
    expect(priced.pricingVersion).toBe(base.pricingVersion + 1);
    const worded = versionVoiceCloneConfig(base, { ...base, consentStatement: "I own this voice." });
    expect(worded.pricingVersion).toBe(base.pricingVersion);
    expect(worded.version).toBe(base.version + 1);
  });

  it("an admin gets the admin slot count whatever their plan says", () => {
    expect(voiceCloneSlotsFor(VOICE_CLONE_DEFAULTS, { audience: "free", isAdmin: true })).toBe(VOICE_CLONE_DEFAULTS.slots.admin);
    expect(voiceCloneSlotsFor(VOICE_CLONE_DEFAULTS, { audience: "pro", isAdmin: false })).toBe(VOICE_CLONE_DEFAULTS.slots.pro);
    // an audience this build does not know is treated as free, never as the most generous row
    expect(voiceCloneSlotsFor(VOICE_CLONE_DEFAULTS, { audience: "mystery", isAdmin: false })).toBe(VOICE_CLONE_DEFAULTS.slots.free);
  });

  it("a format is allowed by MIME type or by extension, and an unrelated file is not", () => {
    expect(voiceCloneFormatAllowed(VOICE_CLONE_DEFAULTS, { name: "take.mp3", mimeType: "application/octet-stream" })).toBe(true);
    expect(voiceCloneFormatAllowed(VOICE_CLONE_DEFAULTS, { name: "take", mimeType: "audio/wav" })).toBe(true);
    expect(voiceCloneFormatAllowed(VOICE_CLONE_DEFAULTS, { name: "clip.mp4", mimeType: "video/mp4" })).toBe(false);
  });

  it("the public config never leaks the model or the operator's cost", () => {
    const pub = publicVoiceCloneConfig({ ...VOICE_CLONE_DEFAULTS, providerCostPerCloneUsdCents: 42 }, { code: "USD", symbol: "$" }, { usable: true, audience: "pro", isAdmin: false });
    const json = JSON.stringify(pub);
    expect(json).not.toContain(VOICE_CLONE_DEFAULTS.model);
    expect(json).not.toContain("42");
    expect(pub.slots).toBe(VOICE_CLONE_DEFAULTS.slots.pro);
  });

  it("the price line says the free voice first, because that is the offer", () => {
    const pub = publicVoiceCloneConfig({ ...VOICE_CLONE_DEFAULTS, perCloneCents: 50_000, freeClonesPerMonth: 1 }, { code: "NGN", symbol: "₦" }, { usable: true, audience: "free", isAdmin: false });
    expect(pub.priceLine).toBe("Your first voice each month is free, then ₦500.00 a voice");
  });
});

describe("the price of one voice", () => {
  it("a covered voice is free, and the minimum charge does not apply to it", () => {
    const q = quoteVoiceClone({ freeClonesAvailable: 1 }, { ...VOICE_CLONE_DEFAULTS, perCloneCents: 500, minimumChargeCents: 200 }, { currency: "USD" });
    expect(q.freeCovered).toBe(true);
    expect(q.totalCents).toBe(0);
    expect(q.lines.every((l) => l.amountCents === 0)).toBe(true);
  });

  it("with no allowance left it is the price, raised to the minimum", () => {
    const q = quoteVoiceClone({ freeClonesAvailable: 0 }, { ...VOICE_CLONE_DEFAULTS, perCloneCents: 100, minimumChargeCents: 250 }, { currency: "USD" });
    expect(q.totalCents).toBe(250);
    expect(q.lines.map((l) => l.key)).toEqual(["voice", "minimum"]);
  });

  it("an allowance of zero means nothing is ever covered, even with a remaining count", () => {
    const q = quoteVoiceClone({ freeClonesAvailable: 3 }, { ...VOICE_CLONE_DEFAULTS, freeClonesPerMonth: 0, perCloneCents: 500 }, { currency: "USD" });
    expect(q.freeCovered).toBe(false);
    expect(q.totalCents).toBe(500);
  });

  it("the public quote drops the operator's cost estimate", () => {
    const q = quoteVoiceClone({ freeClonesAvailable: 0 }, { ...VOICE_CLONE_DEFAULTS, providerCostPerCloneUsdCents: 7 }, { currency: "USD" });
    expect(q.providerCostEstimateUsdCents).toBe(7);
    expect("providerCostEstimateUsdCents" in publicVoiceCloneQuote(q)).toBe(false);
  });

  it("the month key is the operator's zone, and an unknown zone falls back rather than throwing", () => {
    const at = new Date("2026-01-01T02:30:00Z");
    expect(voiceCloneMonthKey(at, "Pacific/Auckland")).toBe("2026-01");
    expect(voiceCloneMonthKey(at, "America/Los_Angeles")).toBe("2025-12");
    expect(voiceCloneMonthKey(at, "Not/AZone")).toBe("2026-01");
  });
});

describe("the bodies a route accepts", () => {
  const sample = { name: "take-1.mp3", mimeType: "audio/mpeg", size: 1024, durationMs: 30_000 };

  it("a create body needs a name and at least one sample", () => {
    expect(createVoiceCloneJobSchema.safeParse({ clientRequestId: "abcdefgh", name: "My voice", samples: [sample] }).success).toBe(true);
    expect(createVoiceCloneJobSchema.safeParse({ clientRequestId: "abcdefgh", name: "My voice", samples: [] }).success).toBe(false);
    expect(createVoiceCloneJobSchema.safeParse({ clientRequestId: "abcdefgh", name: "  ", samples: [sample] }).success).toBe(false);
  });

  it("a field nobody declared does not parse — nothing a client invents reaches a handler", () => {
    expect(createVoiceCloneJobSchema.safeParse({ clientRequestId: "abcdefgh", name: "V", samples: [sample], providerVoiceId: "21m00Tcm4TlvDq8ikWAM" }).success).toBe(false);
    expect(createVoiceCloneJobSchema.safeParse({ clientRequestId: "abcdefgh", name: "V", samples: [{ ...sample, voiceId: "x" }] }).success).toBe(false);
  });

  /*
    🔴 THE ONE THAT MATTERS MOST. `consent: true` is a LITERAL, so there is no
    code path — not a retry, not an internal caller, not a future script — that
    can start a clone without the member having agreed.
  */
  it("a start body without consent does not parse, and `false` does not either", () => {
    expect(startVoiceCloneJobSchema.safeParse({ consent: true, consentName: "A Name" }).success).toBe(true);
    expect(startVoiceCloneJobSchema.safeParse({}).success).toBe(false);
    expect(startVoiceCloneJobSchema.safeParse({ consent: false }).success).toBe(false);
    expect(startVoiceCloneJobSchema.safeParse({ consent: "true" }).success).toBe(false);
  });
});

describe("the row's contract", () => {
  const meta = {
    tool: "voice_clone",
    name: "My voice",
    description: "",
    samples: [{ path: "u/ai_voice_clone/j/sample-1.mp3", mime: "audio/mpeg", size: 100, durationMs: 1000, name: "take.mp3" }],
    quote: { totalCents: 0 },
    billing: { type: "FREE_ALLOWANCE", normalPriceCents: 0, chargedCents: 0, currency: "USD" },
    free_clones: { monthKey: "2026-09", covered: 1 },
    consent: { at: "2026-09-27T00:00:00.000Z", name: "A Name", statement: VOICE_CLONE_CONSENT_STATEMENT },
    clone_id: null,
    provider: { id: "elevenlabs", model: "eleven" },
  };

  it("reads a complete row", () => {
    expect(readVoiceCloneMeta(meta)?.name).toBe("My voice");
  });

  it("refuses another tool's row", () => {
    expect(readVoiceCloneMeta({ ...meta, tool: "text_to_audio" })).toBeNull();
  });

  it("a draft is readable before anything is priced or consented to", () => {
    const draft = readVoiceCloneDraft({ tool: "voice_clone", name: "V", description: "", samples: meta.samples });
    expect(draft?.samples).toHaveLength(1);
    // no samples is not a draft: there is nothing to clone from
    expect(readVoiceCloneDraft({ tool: "voice_clone", name: "V", samples: [] })).toBeNull();
  });
});

describe("a clone reaching another tool", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("a clone id round-trips, and a catalogue id is not mistaken for one", () => {
    expect(voiceIdForClone(id)).toBe(`clone:${id}`);
    expect(isCloneVoiceId(voiceIdForClone(id))).toBe(true);
    expect(cloneIdFromVoiceId(voiceIdForClone(id))).toBe(id);
    expect(isCloneVoiceId("ela-sarah-mature-reassuring-confident")).toBe(false);
    expect(cloneIdFromVoiceId("ela-sarah-mature-reassuring-confident")).toBeNull();
  });

  /*
    🔴 A malformed id answers null rather than "close enough". The value came
    from a browser; the only thing that makes it safe is that it is looked up,
    and a lookup needs a well-formed key.
  */
  it("a malformed clone id answers null rather than being passed along", () => {
    expect(cloneIdFromVoiceId("clone:")).toBeNull();
    expect(cloneIdFromVoiceId("clone:21m00Tcm4TlvDq8ikWAM")).toBeNull();
    expect(cloneIdFromVoiceId(`clone:${id}extra`)).toBeNull();
  });
});

describe("the feature's place in the registry", () => {
  it("is registered, funded like the other paid tools, and has its own tool id", () => {
    const def = aiFeature("ai_voice_clone");
    expect(def).not.toBeNull();
    expect(isWalletFundedFeature("ai_voice_clone")).toBe(true);
    expect(toolIdFor({ feature: "ai_voice_clone" })).toBe("voice_clone");
  });

  /*
    🔴 The two firsts, both deliberate:
      · `requires: "elevenlabs"` — gating on Replicate would refuse cloning on a
        deployment that has everything it needs and accept it on one that has
        none of it.
      · `needsFinalizer: false` — there is no file to bring home; the result is
        a row. Declaring a finalizer it does not use would refuse the tool on a
        deployment with no worker, for a reason that does not apply to it.
  */
  it("needs ElevenLabs rather than Replicate, and needs no finalizer", () => {
    const def = AI_FEATURES.find((f) => f.id === "ai_voice_clone")!;
    expect(def.requires).toBe("elevenlabs");
    expect(def.needsFinalizer).toBe(false);
  });

  it("a sample lands in the job's own folder, so ownership and retention already cover it", () => {
    const key = aiVoiceSampleKey("user-1", "ai_voice_clone", "job-1", 2, "wav");
    expect(key).toBe("user-1/aivoiceclone/job-1/sample-2.wav");
    expect(pathBelongsTo(key, "user-1", "job-1")).toBe(true);
    expect(pathBelongsTo(key, "user-2", "job-1")).toBe(false);
    // the index is bounded whatever a caller passes
    expect(aiVoiceSampleKey("u", "ai_voice_clone", "j", 999, "mp3")).toContain("sample-25.");
    expect(aiVoiceSampleKey("u", "ai_voice_clone", "j", 0, "mp3")).toContain("sample-1.");
  });
});

/**
 * ── 🔴 THE STANDALONE RULE, AS A TEST ───────────────────────────────────────
 *
 * Owner, 2026-09-27: "all ai features pipeline must be standalone to give a
 * cleaner premium result rather than making them all go through same pipeline."
 *
 * The same guard Text to Audio carries. It is here because the drift would be
 * gradual and reasonable-looking every single time: one import of the prepare
 * service to reuse a helper, one video model id to "keep the shapes the same",
 * and the tool is back inside the machinery it was built to stay out of.
 */
describe("it stays standalone", () => {
  const dir = path.join(process.cwd(), "lib", "ai", "voice-clone");
  const files = ["config.ts", "pricing.ts", "free.ts", "schemas.ts", "job-meta.ts", "clones.ts", "provider.ts", "create.ts", "start.ts", "run.ts", "usable.ts", "client.ts", "admin.ts"];
  /*
    🔴 COMMENTS ARE STRIPPED FIRST. These files EXPLAIN what they deliberately
    do not do — "there is no ffmpeg on the frontend", "never a lip sync". A
    check that read the prose would fail on the very sentences that document
    the rule, which is how a good guard gets deleted for being annoying. Only
    code is scanned.
  */
  const BLOCK_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");
  const LINE_COMMENT = new RegExp(String.raw`(^|[^:])//[^\n]*`, "g");
  const stripComments = (text: string) => text.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
  const source = files.map((f) => ({ f, text: stripComments(readFileSync(path.join(dir, f), "utf8")) }));

  it("names no video model and no image-to-video provider", () => {
    for (const { f, text } of source) {
      for (const forbidden of ["wan-animate", "wan_animate", "propainter", "ProPainter", "kling", "sync-3", "sync3", "minimax", "lip-sync/", "lipsync"]) {
        expect(text.toLowerCase().includes(forbidden.toLowerCase()), `${f} mentions ${forbidden}`).toBe(false);
      }
    }
  });

  it("imports no prepare service, no worker and no ffmpeg", () => {
    for (const { f, text } of source) {
      for (const forbidden of ["prepare-service", "@/lib/worker", "ffmpeg", "hasWorker"]) {
        expect(text.includes(forbidden), `${f} imports ${forbidden}`).toBe(false);
      }
    }
  });

  it("builds nothing on Replicate or fal.ai — the owner's 2026-09-27 rule", () => {
    for (const { f, text } of source) {
      for (const forbidden of ["lib/ai/replicate", "lib/ai/fal", "createReplicatePrediction", "REPLICATE_API_TOKEN", "FAL_KEY"]) {
        expect(text.includes(forbidden), `${f} references ${forbidden}`).toBe(false);
      }
    }
  });

  it("declares no pipeline stages: one provider step, so there is nothing to advance", () => {
    const start = source.find((s) => s.f === "start.ts")!.text;
    expect(start).toContain("pipeline: null");
    expect(start.includes("stages:")).toBe(false);
  });
});

/**
 * ── 🔴 THE SECURITY-PASS FINDING, AS A TEST ─────────────────────────────────
 *
 * A voice outlives the job that made it and `ai_voice_clones.job_id` is
 * `on delete set null`. `pathBelongsTo` needs a job id, so for an older voice it
 * answers FALSE — and the delete path, which used it, silently skipped removing
 * the member's recordings. The product said the voice and its recordings were
 * gone; the audio was still in the bucket.
 *
 * Caught in the security pass on 2026-09-27, before this shipped. These tests
 * pin the narrower check that replaced it: it still refuses another member's
 * prefix and still refuses traversal — it only stops requiring the job.
 */
describe("ownership of a recording whose job row is gone", () => {
  const key = aiVoiceSampleKey("owner-1", "ai_voice_clone", "job-1", 1, "mp3");

  it("the job-scoped check answers false without a job id — the bug this replaced", () => {
    expect(pathBelongsTo(key, "owner-1", "")).toBe(false);
  });

  it("the owner-scoped check accepts the owner's own path", () => {
    expect(pathBelongsToOwner(key, "owner-1")).toBe(true);
  });

  it("and still refuses another member, a traversal and a wrong shape", () => {
    expect(pathBelongsToOwner(key, "owner-2")).toBe(false);
    expect(pathBelongsToOwner("owner-1/ai_voice_clone/../other/sample-1.mp3", "owner-1")).toBe(false);
    expect(pathBelongsToOwner("/owner-1/aivoiceclone/job-1/sample-1.mp3", "owner-1")).toBe(false);
    expect(pathBelongsToOwner("owner-1/aivoiceclone/sample-1.mp3", "owner-1")).toBe(false);
  });
});

/**
 * ── 🔴 THE 2026-09-27 PRODUCTION BUG, AS A TEST ─────────────────────────────
 *
 * Owner: "when voice clone a voice it shows couldn't finish but it still shows
 * in history, it should show success when it is successful."
 *
 * Both of their clones WERE made — `ai_voice_clones` held two `ready` rows with
 * real vendor voice ids — and both jobs said `failed / INTERNAL_ERROR`. The
 * cause was one line: `run.ts` moved the row `processing → completed`, which
 * `TRANSITIONS` forbids and `transitionJob` THROWS on, so the throw landed in
 * the catch that fails and refunds the job — after the voice already existed.
 *
 * These tests pin both halves: the rule, and the fact that this file walks it.
 */
describe("the status road a finished clone takes", () => {
  it("processing may NOT reach completed — the short cut that failed two real voices", () => {
    expect(canTransition("processing", "completed")).toBe(false);
    expect(canTransition("processing", "finalizing")).toBe(true);
    expect(canTransition("finalizing", "completed")).toBe(true);
  });

  it("run.ts claims finalizing before completing, and never completes straight out of processing", () => {
    const run = readFileSync(path.join(process.cwd(), "lib", "ai", "voice-clone", "run.ts"), "utf8");
    expect(run).toContain(`"finalizing", {}`);
    expect(run).toContain(`transitionJob(jobId, ["finalizing"], "completed"`);
    expect(run.includes(`["processing"], "completed"`)).toBe(false);
  });

  /*
    The invariant the bug broke. Everything that can honestly fail happens
    before the voice is made; after it, a bookkeeping problem is the operator's
    to read in the log, not the member's to see as a failure.
  */
  it("a throw after the voice exists completes the job instead of failing it", () => {
    const run = readFileSync(path.join(process.cwd(), "lib", "ai", "voice-clone", "run.ts"), "utf8");
    expect(run).toContain("getVoiceCloneByJob");
    expect(run).toMatch(/threw AFTER the voice was made/);
  });

  it("a library row that cannot be written removes the vendor's voice rather than leaking a slot", () => {
    const run = readFileSync(path.join(process.cwd(), "lib", "ai", "voice-clone", "run.ts"), "utf8");
    expect(run).toContain("provider.remove(made.providerVoiceId)");
  });
});
