import { describe, expect, it } from "vitest";

import { overviewFeatures, summarizeFeatureHealth, type JobRow } from "@/lib/ai/providers/overview";

/**
 * Admin → AI → Providers (Part 8 §9, §13, §39, §62): the health line must be
 * honest. No jobs is "unknown", never a green "healthy"; a missing credential
 * is "unavailable" whatever the history says; repeated failures are grouped.
 */
const job = (over: Partial<JobRow>): JobRow => ({
  feature: "ai_text_to_video",
  status: "completed",
  error_code: null,
  created_at: "2026-10-05T10:00:00.000Z",
  completed_at: "2026-10-05T10:01:00.000Z",
  ...over,
});
const ON = { kling: true, elevenlabs: true };

describe("provider overview", () => {
  it("names every live tool with its real provider — video on Kling, audio on ElevenLabs", () => {
    const f = overviewFeatures();
    expect(f.map((x) => [x.id, x.vendor])).toEqual([
      ["ai_text_to_video", "kling"],
      ["ai_image_to_video", "kling"],
      ["ai_lip_sync", "kling"],
      ["ai_text_to_audio", "elevenlabs"],
      ["ai_voice_clone", "elevenlabs"],
    ]);
    expect(JSON.stringify(f)).not.toMatch(/replicate|fal/i);
  });

  it("no jobs is UNKNOWN, never healthy", () => {
    const [t2v] = summarizeFeatureHealth(overviewFeatures(), [], ON);
    expect(t2v!.state).toBe("unknown");
    expect(t2v!.lastSuccessAt).toBeNull();
  });

  it("a missing credential is UNAVAILABLE even with a clean history", () => {
    const [t2v] = summarizeFeatureHealth(overviewFeatures(), [job({})], { kling: false, elevenlabs: true });
    expect(t2v!.state).toBe("unavailable");
  });

  it("over a quarter failing is DEGRADED, and failures are grouped by code", () => {
    const rows = [
      job({}),
      job({ status: "failed", error_code: "KLING_1203" }),
      job({ status: "failed", error_code: "KLING_1203", completed_at: "2026-10-05T11:00:00.000Z" }),
      job({ status: "failed", error_code: "FINALIZE_FAILED" }),
      job({ status: "processing", completed_at: null }),
    ];
    const [t2v] = summarizeFeatureHealth(overviewFeatures(), rows, ON);
    expect(t2v!.state).toBe("degraded");
    expect(t2v!.completed).toBe(1);
    expect(t2v!.failed).toBe(3);
    expect(t2v!.inFlight).toBe(1);
    expect(t2v!.topFailure).toEqual({ code: "KLING_1203", count: 2 });
    expect(t2v!.lastFailure?.at).toBe("2026-10-05T11:00:00.000Z");
  });

  it("a mostly-succeeding tool is HEALTHY, and one tool's jobs never count for another", () => {
    const rows = [job({}), job({}), job({}), job({ status: "failed", error_code: "X" }), job({ feature: "ai_lip_sync", status: "failed" })];
    const health = summarizeFeatureHealth(overviewFeatures(), rows, ON);
    expect(health.find((h) => h.id === "ai_text_to_video")!.state).toBe("healthy");
    expect(health.find((h) => h.id === "ai_lip_sync")!.failed).toBe(1);
    expect(health.find((h) => h.id === "ai_image_to_video")!.state).toBe("unknown");
  });
});
