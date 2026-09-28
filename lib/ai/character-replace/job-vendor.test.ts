import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { jobVendor, readProviderPlan, stageVendor } from "./job-meta";
import { AI_PROVIDER_IDS } from "../jobs";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/**
 * Comments stripped. The ordering assertions below compare the POSITION of two
 * statements, and a comment that quotes the code it explains would otherwise be
 * matched instead — which is exactly what happened the first time this ran.
 */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 A KLING JOB MUST STAY A KLING JOB (Part 4 §8)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, §8: "A Kling job must remain `provider = kling` through its entire
 * lifecycle. Never allow `kling → replicate` because of a narrow TypeScript
 * union, default branch, or legacy helper."
 *
 * There was exactly such a default branch. `jobVendor` ended in:
 *
 *     return row.provider === "fal" ? "fal" : "replicate";
 *
 * — so every value it did not recognise, `kling` included, came back as
 * `"replicate"`. That is not a display detail: `jobVendor`'s answer picks the
 * ADAPTER that polls and cancels the job (`lib/ai/reconcile.ts`,
 * `app/api/ai/jobs/[id]/cancel/route.ts`). A Kling task id polled at Replicate
 * is a task Replicate has never heard of, which the reconciler reads as gone —
 * so a job the member paid for gets failed while it is still running.
 *
 * Every test below fails against that old one-line implementation.
 */

describe("jobVendor — a row's vendor is believed, never defaulted away", () => {
  it("🔴 a kling row reads as kling (the regression this file exists for)", () => {
    expect(jobVendor({ provider: "kling" })).toBe("kling");
    expect(jobVendor({ provider: "kling", metadata: {} })).toBe("kling");
  });

  it("every provider the database accepts survives a round trip", () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(jobVendor({ provider: id }), id).toBe(id);
    }
  });

  it("a row with no provider at all is still Replicate — a real historical fact, not a default for unknowns", () => {
    // Rows written before the column existed genuinely ran on Replicate (§27).
    expect(jobVendor({})).toBe("replicate");
    expect(jobVendor({ provider: null })).toBe("replicate");
    expect(jobVendor({ provider: "   " })).toBe("replicate");
  });

  it("an unrecognised vendor string does not silently become Replicate's problem", () => {
    // It is not a known vendor, so it falls back — but the fallback is reached
    // only for values the DB constraint could not contain anyway.
    expect(jobVendor({ provider: "some-new-vendor" })).toBe("replicate");
  });

  it("🔴 the pipeline's own stage record wins, and a kling record is read as kling", () => {
    const metadata = {
      pipeline: {
        stages: ["replace", "finalize"],
        current: "replace",
        records: { replace: { status: "submitted", provider: { id: "kling", model: "kling-v3-omni", version: null }, predictionId: "t1" } },
      },
    };
    // The row's column deliberately disagrees: the RECORD is what actually ran.
    expect(jobVendor({ provider: "replicate", metadata })).toBe("kling");
  });

  it("🔴 a kling stage record still PARSES — a narrow zod enum would hide the whole pipeline", () => {
    const metadata = {
      pipeline: {
        stages: ["replace", "finalize"],
        current: "replace",
        records: { replace: { status: "submitted", provider: { id: "kling", model: "kling-v3-omni", version: null } } },
      },
    };
    // If the enum refused "kling", readPipeline would answer null, jobVendor
    // would fall through to the row, and the reconciler would lose the stage.
    expect(jobVendor({ provider: "kling", metadata })).toBe("kling");
  });

  it("the provider PLAN is read for kling too", () => {
    const metadata = { provider_plan: { id: "kling", model: "kling-v3-omni", lipSync: { id: "kling", model: "kling-lip-sync", version: null } } };
    expect(readProviderPlan(metadata)?.id).toBe("kling");
    expect(stageVendor({ provider: "kling", metadata }, "replace")).toBe("kling");
    expect(stageVendor({ provider: "kling", metadata }, "lipsync")).toBe("kling");
  });

  it("the voice stage stays on Replicate — a TTS prediction is not the replacement vendor", () => {
    const metadata = { provider_plan: { id: "kling", model: "kling-v3-omni" } };
    expect(stageVendor({ provider: "kling", metadata }, "voice")).toBe("replicate");
  });
});

describe("🔴 the Replicate/fal paths REFUSE a kling row rather than mis-submitting it", () => {
  /*
    Each of these paths chose a webhook URL, a model table or an adapter from the
    vendor. With `kling` silently mapped to `replicate` they would have: given the
    job the REPLICATE callback URL (so the real report arrives at a route that
    verifies Replicate signatures and discards it), or read `.model` off an
    `undefined` entry in a two-key table (a TypeError mid-submit, after the
    charge). Both are worse than a refusal, so a refusal is asserted.
  */
  it("character-replace submit refuses a kling vendor before choosing a webhook URL", () => {
    const source = code("lib/ai/character-replace/submit.ts");
    const refusal = source.indexOf('if (vendor !== "replicate" && vendor !== "fal")');
    const webhook = source.indexOf("const webhookUrl =");
    expect(refusal).toBeGreaterThan(-1);
    expect(webhook).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(webhook);
  });

  it("lip-sync submit refuses ANY non-legacy vendor before indexing the two-vendor model table", () => {
    const source = code("lib/ai/lip-sync/submit.ts");
    const refusal = source.indexOf('if (vendor !== "replicate" && vendor !== "fal")');
    const lookup = source.indexOf("config.models[vendor]");
    expect(refusal).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(lookup);
  });

  it("the lip-sync PREPARE service refuses them too — the worker path, not just the submit path", () => {
    const source = code("server/services/ai-lip-sync-prepare-service.ts");
    const refusal = source.indexOf('if (vendor !== "replicate" && vendor !== "fal")');
    const lookup = source.indexOf("config.models[vendor]");
    expect(refusal).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(lookup);
  });
});

describe("the vendor list is written once", () => {
  it("🔴 job-meta derives its zod enum from AI_PROVIDER_IDS instead of re-listing the vendors", () => {
    const source = src("lib/ai/character-replace/job-meta.ts");
    expect(source).toContain("const JOB_VENDORS = AI_PROVIDER_IDS");
    // The plan/vendor enums must come from the shared constant, not a literal list.
    expect(source).toContain("z.enum(JOB_VENDORS)");
  });

  it("AI_PROVIDER_IDS is a tuple, so a zod enum can be built from it at all", () => {
    // 2026-09-28 (Part 5): `elevenlabs` joined so the two direct-ElevenLabs tools can
    // name their real vendor instead of borrowing "replicate".
    expect(AI_PROVIDER_IDS).toEqual(["replicate", "fal", "kling", "elevenlabs"]);
    expect(AI_PROVIDER_IDS.length).toBe(4);
  });
});
