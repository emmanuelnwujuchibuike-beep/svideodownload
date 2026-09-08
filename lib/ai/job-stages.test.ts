import { describe, expect, it } from "vitest";

import { AI_CLEAN_PATH, nextPollDelayMs, pathState, stageFor } from "./job-stages";
import type { AiJobStatus, AiJobView } from "./jobs";

const job = (status: AiJobStatus, extra: Partial<AiJobView> = {}): AiJobView => ({
  id: "11111111-2222-3333-4444-555555555555",
  feature: "ai_clean",
  status,
  createdAt: "2026-09-07T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  expiresAt: null,
  durationMs: null,
  source: { size: null, mimeType: null, durationSeconds: null, name: null },
  result: { size: null, durationSeconds: null, audioRestored: null },
  error: null,
  ...extra,
});

describe("stageFor", () => {
  it("shows the upload while the browser is still sending", () => {
    const view = stageFor({ job: null, uploading: true, uploadFraction: 0.5 });
    expect(view.stage).toBe("uploading");
    expect(view.active).toBe(true);
  });

  it("🔴 moves the upload bar with REAL bytes sent", () => {
    // The only genuine percentage in this feature: the browser counts what it
    // has actually put on the wire.
    const quarter = stageFor({ job: null, uploading: true, uploadFraction: 0.25 });
    const done = stageFor({ job: null, uploading: true, uploadFraction: 1 });
    expect(quarter.progress!).toBeLessThan(done.progress!);
  });

  it("reads each job status as its own stage", () => {
    expect(stageFor({ job: job("queued") }).stage).toBe("queued");
    expect(stageFor({ job: job("processing") }).stage).toBe("processing");
    expect(stageFor({ job: job("finalizing") }).stage).toBe("finalizing");
    expect(stageFor({ job: job("completed") }).stage).toBe("completed");
    expect(stageFor({ job: job("failed") }).stage).toBe("failed");
    expect(stageFor({ job: job("cancelled") }).stage).toBe("cancelled");
    expect(stageFor({ job: job("expired") }).stage).toBe("expired");
  });

  it("knows which states still change, because that is what drives polling", () => {
    expect(stageFor({ job: job("queued") }).active).toBe(true);
    expect(stageFor({ job: job("processing") }).active).toBe(true);
    // Finalizing is still work in flight — polling must not stop here, or a
    // member watches "restoring your audio" forever on a job that finished.
    expect(stageFor({ job: job("finalizing") }).active).toBe(true);
    for (const status of ["completed", "failed", "cancelled", "expired"] as AiJobStatus[]) {
      expect(stageFor({ job: job(status) }).active, status).toBe(false);
    }
  });

  it("🔴 never invents a percentage while the model runs", () => {
    // Two reads of the same processing job must be identical. A number that
    // differed between them would be a timer pretending to be progress.
    const first = stageFor({ job: job("processing") });
    const second = stageFor({ job: job("processing") });
    expect(first.progress).toBe(second.progress);
    expect(first.progress).toBeLessThan(1);
  });

  it("only reaches 1 when the job is genuinely finished", () => {
    expect(stageFor({ job: job("completed") }).progress).toBe(1);
    // Finalizing is close, and still not done. A bar that hit 100% before the
    // file existed would be the same lie as a fake percentage.
    expect(stageFor({ job: job("finalizing") }).progress!).toBeLessThan(1);
    expect(stageFor({ job: job("finalizing") }).progress!).toBeGreaterThan(
      stageFor({ job: job("processing") }).progress!,
    );
  });

  it("shows a failure in the server's own words", () => {
    const view = stageFor({
      job: job("failed", { error: { code: "PROVIDER_ERROR", message: "The AI service didn't respond." } }),
    });
    expect(view.detail).toBe("The AI service didn't respond.");
  });

  it("is idle before anything exists", () => {
    const view = stageFor({ job: null });
    expect(view.stage).toBe("idle");
    expect(view.progress).toBeNull();
    expect(view.active).toBe(false);
  });
});

describe("pathState", () => {
  it("shows the whole journey at every stage", () => {
    for (const stage of ["uploading", "queued", "processing", "finalizing", "completed"] as const) {
      const state = pathState(stage);
      expect(Object.keys(state).sort(), stage).toEqual(AI_CLEAN_PATH.map((p) => p.key).sort());
    }
  });

  it("🔴 never announces a step we cannot observe as the current one", () => {
    /*
      "Analyzing video" is not a separate signal — the model does detection and
      inpainting inside one prediction reporting a single `processing` state.
      It appears in the path so the member sees the journey, and lights up
      TOGETHER with "Removing text" rather than before it, because choosing
      between them would mean deciding by a timer.
    */
    const processing = pathState("processing");
    expect(processing.analyzing).toBe("doing");
    expect(processing.removing).toBe("doing");

    // 🔴 And NOT finalizing: while the AI runs, the audio mux has not started.
    // Marking it "doing" here is exactly the fabrication this test guards.
    expect(processing.finalizing).toBe("todo");

    // Nothing is "doing" at a stage where nothing is running.
    const queued = pathState("queued");
    expect(queued.analyzing).toBe("todo");
    expect(queued.finalizing).toBe("todo");
  });

  it("Part 4: finalizing is a REAL step, so it gets announced on its own", () => {
    // The audio mux runs in our own worker and the row says `finalizing` while
    // it does — announced because it is happening, not because a timer said so.
    const state = pathState("finalizing");
    expect(state.finalizing).toBe("doing");
    expect(state.removing).toBe("done");
    expect(state.analyzing).toBe("done");
    expect(state.ready).toBe("todo");
  });

  it("marks earlier steps done as the job moves on", () => {
    expect(pathState("queued").uploading).toBe("done");
    expect(pathState("processing").queued).toBe("done");
    expect(pathState("completed").ready).toBe("done");
  });

  it("marks nothing done before the upload has started", () => {
    const state = pathState("uploading");
    expect(state.uploading).toBe("doing");
    expect(state.queued).toBe("todo");
    expect(state.ready).toBe("todo");
  });
});

describe("nextPollDelayMs", () => {
  it("starts responsive and backs off", () => {
    expect(nextPollDelayMs(0)).toBeLessThanOrEqual(3_000);
    expect(nextPollDelayMs(20)).toBeGreaterThan(nextPollDelayMs(0));
    expect(nextPollDelayMs(100)).toBeGreaterThanOrEqual(nextPollDelayMs(20));
  });

  it("🔴 never polls faster than a second, at any attempt count", () => {
    // The brief's own example of what not to do: every 500ms forever, on a
    // phone, for a job that takes ten minutes.
    for (const attempt of [0, 1, 5, 50, 500, 10_000]) {
      expect(nextPollDelayMs(attempt), String(attempt)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("never grows without bound either — a finished job is always noticed", () => {
    expect(nextPollDelayMs(10_000)).toBeLessThanOrEqual(30_000);
  });
});

/**
 * The creeping progress — added 2026-09-08 after the owner reported the bar
 * "delaying at 60% while removing text" and looking stuck.
 *
 * 🔴 These tests exist to keep it HONEST, not merely moving. A bar that creeps
 * is only acceptable while it cannot claim a step that has not happened.
 */
describe("progress creeps without lying", () => {
  const job = (status: string, startedSecondsAgo: number, now: number) =>
    ({
      job: {
        status,
        createdAt: new Date(now - startedSecondsAgo * 1000).toISOString(),
        startedAt: new Date(now - startedSecondsAgo * 1000).toISOString(),
        error: null,
      },
      now,
    }) as never;

  const NOW = Date.parse("2026-09-08T12:00:00.000Z");

  it("moves while processing, so it never looks frozen", () => {
    const at10 = stageFor(job("processing", 10, NOW)).progress ?? 0;
    const at60 = stageFor(job("processing", 60, NOW)).progress ?? 0;
    const at180 = stageFor(job("processing", 180, NOW)).progress ?? 0;

    expect(at10).toBeGreaterThan(0.6);
    expect(at60).toBeGreaterThan(at10);
    expect(at180).toBeGreaterThan(at60);
  });

  it("🔴 never reaches the next stage's floor, however long it waits", () => {
    // An hour in — far beyond any real job — it must still be short of the
    // value that means "finalizing has started".
    const forever = stageFor(job("processing", 3600, NOW)).progress ?? 0;
    expect(forever).toBeLessThan(0.85);
  });

  it("🔴 only genuine completion reaches 100%", () => {
    expect(stageFor(job("processing", 99999, NOW)).progress).toBeLessThan(1);
    expect(stageFor(job("finalizing", 99999, NOW)).progress).toBeLessThan(1);
    expect(stageFor(job("completed", 1, NOW)).progress).toBe(1);
  });

  it("decelerates, because a straight line would promise a finish time", () => {
    const p = (s: number) => stageFor(job("processing", s, NOW)).progress ?? 0;
    const firstMinute = p(60) - p(0);
    const secondMinute = p(120) - p(60);
    expect(secondMinute).toBeLessThan(firstMinute);
  });
});
