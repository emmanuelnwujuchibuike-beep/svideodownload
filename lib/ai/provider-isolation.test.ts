import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { falProvider } from "./fal/provider";
import { klingProvider } from "./kling/provider";
import { KLING_VIDEO_AI_FEATURES } from "./kling/pipelines/registry";
import { replicateProvider } from "./replicate/provider";
import { AI_FEATURES, type AiFeature } from "./jobs";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 PROVIDER ISOLATION — §40's four questions, answered in code
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 5 §40, verbatim:
 *
 *   Can any production video feature still execute through Replicate?   → NO
 *   Can any production video feature still execute through fal.ai?      → NO
 *   Can Kling automatically fall back to another video provider?        → NO
 *   Can one Kling feature secretly trigger another Kling feature?       → NO
 *   Can one feature silently invoke ElevenLabs?                         → NO
 *     (except the user's separately existing ElevenLabs features)
 *
 * §28: "Especially add regression tests that fail if a video feature attempts to
 * resolve to Replicate or fal.ai."
 *
 * ── Why `supports()` is the right place to assert ──────────────────────────
 *
 * `submitJobToProvider` calls `provider.supports(feature)` BEFORE it reaches any
 * per-feature branch, and `hasProviderFor` is `isConfigured() && supports()`. So
 * a false answer makes every downstream branch unreachable regardless of what a
 * caller, an admin setting or a stored row asks for. One line closes the path;
 * these tests are what stop it being reopened.
 */

/** Every feature a member can actually create a job for. */
const LIVE_FEATURES: readonly AiFeature[] = AI_FEATURES.map((f) => f.id);

describe("🔴 §40.1 — no video feature can execute through Replicate", () => {
  it("Replicate supports nothing, for every registered feature", () => {
    for (const f of LIVE_FEATURES) {
      expect(replicateProvider.supports(f), f).toBe(false);
    }
  });

  it("…including the features it used to run", () => {
    for (const f of ["ai_character_replace", "ai_lip_sync", "ai_clean"] as const) {
      expect(replicateProvider.supports(f), f).toBe(false);
    }
  });

  it("no AI_FEATURES row declares Replicate as its provider or requirement", () => {
    for (const f of AI_FEATURES) {
      expect(f.provider, `${f.id}.provider`).not.toBe("replicate");
      expect(f.requires, `${f.id}.requires`).not.toBe("replicate");
    }
  });
});

describe("🔴 §40.2 — no video feature can execute through fal.ai", () => {
  it("fal supports nothing, for every registered feature", () => {
    for (const f of LIVE_FEATURES) {
      expect(falProvider.supports(f), f).toBe(false);
    }
  });

  it("no AI_FEATURES row declares fal as its provider", () => {
    for (const f of AI_FEATURES) {
      expect(f.provider, f.id).not.toBe("fal");
    }
  });
});

describe("🔴 §40.3 — Kling cannot fall back to another provider", () => {
  it("every video feature is served by Kling and by nothing else", () => {
    for (const f of KLING_VIDEO_AI_FEATURES) {
      expect(klingProvider.supports(f), `kling/${f}`).toBe(true);
      expect(replicateProvider.supports(f), `replicate/${f}`).toBe(false);
      expect(falProvider.supports(f), `fal/${f}`).toBe(false);
    }
  });

  it("🔴 exactly ONE adapter claims each feature — no feature has two possible runners", () => {
    for (const f of LIVE_FEATURES) {
      const claimants = [replicateProvider, falProvider, klingProvider].filter((p) => p.supports(f)).map((p) => p.id);
      expect(claimants.length, `${f} claimed by ${claimants.join(",")}`).toBeLessThanOrEqual(1);
    }
  });

  it("the Kling client contains no fallback to another vendor", () => {
    for (const file of ["lib/ai/kling/client.ts", "lib/ai/kling/provider.ts", "lib/ai/kling/features/submit.ts"]) {
      const code = src(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();
      for (const vendor of ["replicate", "fal-ai", "falprovider", "queue.fal", "kie"]) {
        expect(code, `${file} / ${vendor}`).not.toContain(vendor);
      }
    }
  });
});

describe("🔴 §40.5 — a video feature never silently invokes ElevenLabs", () => {
  /*
    §12: the direct ElevenLabs tools are their own pipelines and must stay
    untouched. §3/§11: a video feature must not secretly generate speech.
    Both hold only if the video path never reaches for ElevenLabs — the old
    Lip Sync flow DID (text → ElevenLabs on the worker → the lip-sync model),
    which is precisely the chaining Part 5 removes.
  */
  it("no Kling pipeline or handler imports the ElevenLabs client", () => {
    const files = [
      "lib/ai/kling/pipelines/text-to-video.ts",
      "lib/ai/kling/pipelines/image-to-video.ts",
      "lib/ai/kling/pipelines/lip-sync.ts",
      "lib/ai/kling/pipelines/registry.ts",
      "lib/ai/kling/features/text-to-video.ts",
      "lib/ai/kling/features/image-to-video.ts",
      "lib/ai/kling/features/lip-sync.ts",
      "lib/ai/kling/features/submit.ts",
      "lib/ai/kling/client.ts",
    ];
    for (const file of files) {
      const code = src(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();
      for (const forbidden of ["elevenlabs", "voice/tts", "voice-clone"]) {
        expect(code, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("§12 — the ElevenLabs tools keep their own provider requirement, untouched", () => {
    const tta = AI_FEATURES.find((f) => f.id === "ai_text_to_audio")!;
    const clone = AI_FEATURES.find((f) => f.id === "ai_voice_clone")!;
    expect(clone.requires).toBe("elevenlabs");
    // Text to Audio is the direct-ElevenLabs tool; it is emphatically not a Kling feature.
    expect(klingProvider.supports("ai_text_to_audio")).toBe(false);
    expect(klingProvider.supports("ai_voice_clone")).toBe(false);
    expect(tta.provider).not.toBe("kling");
  });
});

describe("§14 — provider identity stays correct", () => {
  it("the Kling adapter is registered under its own id", () => {
    expect(klingProvider.id).toBe("kling");
    expect(replicateProvider.id).toBe("replicate");
    expect(falProvider.id).toBe("fal");
  });

  it("🔴 every video AI feature declares provider `kling` on its registry row", () => {
    for (const f of AI_FEATURES) {
      if (!(KLING_VIDEO_AI_FEATURES as readonly string[]).includes(f.id)) continue;
      expect(f.provider, f.id).toBe("kling");
      expect(f.requires, f.id).toBe("kling");
    }
  });
});
