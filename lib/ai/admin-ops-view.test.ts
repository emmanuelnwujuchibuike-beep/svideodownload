import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAiOperations, failureOwner, groupFailures, providerName, toOpsJob, type OpsJobRow } from "./admin-ops-view";

const NOW = Date.UTC(2026, 9, 7, 12);
const today = (h: number) => new Date(Date.UTC(2026, 9, 7, h)).toISOString();
const yesterday = new Date(Date.UTC(2026, 9, 6, 9)).toISOString();

const row = (over: Partial<OpsJobRow>): OpsJobRow => ({
  id: Math.random().toString(36).slice(2),
  user_id: "u1",
  feature: "ai_text_to_video",
  status: "completed",
  error_code: null,
  error_message: null,
  funding_source: "balance",
  provider: "kling",
  charged_cents: 90,
  created_at: today(8),
  started_at: today(8),
  completed_at: today(9),
  notified_at: today(9),
  replicate_prediction_id: "936716658998779911",
  finalize_error: null,
  billing: "PAID",
  units: "4.5",
  category: null,
  notify_pending: null,
  ...over,
});

describe("whose failure (§38)", () => {
  it("a Kling refusal is the provider's; a finalizer fault is ours; bad input is the member's", () => {
    expect(failureOwner("PROVIDER_UNAVAILABLE", null)).toBe("provider");
    expect(failureOwner("FINALIZER_UNAVAILABLE", null)).toBe("frenzsave");
    expect(failureOwner("AUDIO_TOO_LONG", null)).toBe("member");
    // the job's own recorded category wins
    expect(failureOwner("PROCESSING_FAILED", "provider")).toBe("provider");
    // teeth: an unknown code is never quietly blamed on the provider
    expect(failureOwner("SOMETHING_NEW", null)).toBe("frenzsave");
  });

  it("an expired job with no code is a failure with a name, not a blank", () => {
    expect(toOpsJob(row({ status: "expired", completed_at: null })).failure?.code).toBe("EXPIRED_NO_OUTCOME");
  });
});

describe("§64: the provider is named, never 'auto'", () => {
  it("names Kling and ElevenLabs, marks the retired vendors", () => {
    expect(providerName("kling")).toBe("Kling");
    expect(providerName("elevenlabs")).toBe("ElevenLabs");
    expect(providerName("replicate")).toMatch(/retired/);
  });
});

describe("the overview cards (§62: only what the rows hold)", () => {
  it("counts today, wallet revenue from PAID completions only, and estimated Kling units", () => {
    const ops = buildAiOperations(
      [
        row({}),
        row({ billing: "FREE_TRIAL", funding_source: "free", charged_cents: 0 }),
        row({ status: "failed", error_code: "PROVIDER_UNAVAILABLE", charged_cents: 90, error_message: "kling 429/1102: Account balance not enough" }),
        row({ created_at: yesterday, completed_at: yesterday }),
        row({ feature: "ai_text_to_audio", provider: "elevenlabs", units: null, charged_cents: 20 }),
      ],
      { windowDays: 7, cap: 500, now: NOW },
    );
    const o = ops.overview;
    expect(o.generationsToday).toBe(4);
    expect(o.completedToday).toBe(3);
    expect(o.failedToday).toBe(1);
    expect(o.failureRateToday).toBeCloseTo(0.25);
    // the failed job's 90 and the free one are NOT revenue
    expect(o.walletRevenueTodayCents).toBe(110);
    expect(o.freeToday).toBe(1);
    expect(o.klingUnitsToday).toEqual({ units: 9, jobs: 2, withEstimate: 2 });
  });

  it("teeth: nothing finished today = no failure rate, never a fabricated 0 %", () => {
    const ops = buildAiOperations([row({ created_at: yesterday, completed_at: yesterday })], { windowDays: 7, cap: 500, now: NOW });
    expect(ops.overview.failureRateToday).toBeNull();
  });

  it("says when the read hit its cap", () => {
    expect(buildAiOperations([row({})], { windowDays: 7, cap: 1, now: NOW }).truncated).toBe(true);
  });
});

describe("§39: repeated failures are one row", () => {
  it("groups by code and tool, most frequent first, with first/last seen", () => {
    const jobs = [
      ...Array.from({ length: 7 }, (_, i) => row({ status: "failed", error_code: "PROVIDER_UNAVAILABLE", completed_at: today(i + 1) })),
      row({ status: "failed", error_code: "FINALIZER_UNAVAILABLE", completed_at: today(3) }),
      row({ status: "failed", error_code: "PROVIDER_UNAVAILABLE", feature: "ai_image_to_video", completed_at: today(4) }),
    ].map(toOpsJob);
    const g = groupFailures(jobs);
    expect(g).toHaveLength(3);
    expect(g[0]).toMatchObject({ code: "PROVIDER_UNAVAILABLE", feature: "ai_text_to_video", occurrences: 7, owner: "provider", firstSeen: today(1), lastSeen: today(7) });
  });
});

describe("the read", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/admin-ops.ts"), "utf8");
  it("never selects the whole metadata (it holds members' prompts), and is bounded", () => {
    expect(src).not.toMatch(/"metadata"/);
    expect(src).toMatch(/\.limit\(CAP\)/);
  });
  it("covers every tool, not just the retired Character Replace", () => {
    expect(src).not.toMatch(/\.eq\("feature"/);
  });
});
