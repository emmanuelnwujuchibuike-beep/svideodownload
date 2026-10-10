import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_VIDEO_FEATURES, shouldEmailAiVideo } from "./ready-email";

const on = { masterEnabled: true, categoryPrefs: {} };

describe("'your AI video is ready' email (owner, 2026-10-10)", () => {
  it("goes out for every tool that makes a video, and not for audio or voices", () => {
    for (const f of ["ai_character_replace", "ai_lip_sync", "ai_text_to_video", "ai_image_to_video"] as const) expect(shouldEmailAiVideo(f, on), f).toBe(true);
    expect(shouldEmailAiVideo("ai_text_to_audio", on)).toBe(false);
    expect(shouldEmailAiVideo("ai_voice_clone", on)).toBe(false);
  });

  it("respects the member's switches: all notifications off, or the downloads category off", () => {
    expect(shouldEmailAiVideo("ai_text_to_video", { masterEnabled: false, categoryPrefs: {} })).toBe(false);
    expect(shouldEmailAiVideo("ai_text_to_video", { masterEnabled: true, categoryPrefs: { downloads: { enabled: false } } })).toBe(false);
    // teeth: another category being off changes nothing
    expect(shouldEmailAiVideo("ai_text_to_video", { masterEnabled: true, categoryPrefs: { social: { enabled: false } } })).toBe(true);
  });

  it("is sent exactly once per job: after the notification claim, only for a finished job", () => {
    const src = readFileSync(join(process.cwd(), "lib/ai/notify.ts"), "utf8");
    const finished = src.slice(src.indexOf("export async function notifyAiJobFinished"), src.indexOf("export async function notifyAiJobFailed"));
    const failed = src.slice(src.indexOf("export async function notifyAiJobFailed"));
    expect(finished.indexOf("claimAiNotification(opts.jobId)")).toBeGreaterThan(-1);
    expect(finished.indexOf("emailAiVideoReady(")).toBeGreaterThan(finished.indexOf("claimAiNotification(opts.jobId)"));
    expect(failed).not.toContain("emailAiVideoReady(");
    expect(AI_VIDEO_FEATURES.size).toBeGreaterThanOrEqual(4);
  });
});
