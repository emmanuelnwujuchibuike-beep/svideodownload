import { describe, expect, it } from "vitest";

import { AI_STALL_DEADLINE_MS, stalledForMs, type StallableJob } from "./stall";

/**
 * The deadlines that end a job nobody will ever hear back about.
 *
 * Worth testing precisely because getting these wrong is expensive in both
 * directions: too long and a member watches a dead spinner, too short and we
 * kill a healthy job and hand back an error they did not earn.
 */

const MINUTE = 60_000;
const at = (iso: string) => Date.parse(iso);

function job(over: Partial<StallableJob> = {}): StallableJob {
  return {
    id: "j1",
    status: "processing",
    created_at: "2026-09-08T10:00:00.000Z",
    started_at: "2026-09-08T10:00:00.000Z",
    ...over,
  };
}

describe("stalledForMs", () => {
  it("says nothing about a job that has finished", () => {
    for (const status of ["completed", "failed", "cancelled", "expired"] as const) {
      expect(stalledForMs(job({ status }), at("2026-09-09T00:00:00.000Z"))).toBeNull();
    }
  });

  it("leaves a healthy long-running job alone", () => {
    /*
      🔴 The regression this exists to stop. A real job was observed running
      normally for 19 minutes on 2026-09-08 — video inpainting at 720p plus a
      cold model container. A deadline that fires here would charge the member
      an error for our impatience.
    */
    const nineteenMinutesIn = at("2026-09-08T10:19:00.000Z");
    expect(stalledForMs(job(), nineteenMinutesIn)).toBeNull();
  });

  it("ends a processing job once the provider window is gone", () => {
    const justInside = at("2026-09-08T10:44:59.000Z");
    const justPast = at("2026-09-08T10:45:01.000Z");
    expect(stalledForMs(job(), justInside)).toBeNull();
    expect(stalledForMs(job(), justPast)).toBeGreaterThan(0);
  });

  it("measures a queued job from creation, since it has no start", () => {
    const j = job({ status: "queued", started_at: null });
    expect(stalledForMs(j, at("2026-09-08T10:29:00.000Z"))).toBeNull();
    expect(stalledForMs(j, at("2026-09-08T10:31:00.000Z"))).toBeGreaterThan(0);
  });

  it("falls back to created_at when a started job never recorded its start", () => {
    // A job that never got `started_at` is exactly the kind that stalls, so
    // refusing to judge it would exempt the worst case forever.
    const j = job({ started_at: null });
    expect(stalledForMs(j, at("2026-09-08T10:46:00.000Z"))).toBeGreaterThan(0);
  });

  it("gives finalizing the provider window PLUS the mux, not a fresh clock", () => {
    const j = job({ status: "finalizing" });
    // 50 minutes in: past the processing deadline, still inside finalizing's.
    expect(stalledForMs(j, at("2026-09-08T10:50:00.000Z"))).toBeNull();
    expect(stalledForMs(j, at("2026-09-08T11:01:00.000Z"))).toBeGreaterThan(0);
  });

  it("refuses to act on an unparseable timestamp rather than failing the job", () => {
    const j = job({ created_at: "not a date", started_at: null });
    expect(stalledForMs(j, Date.now())).toBeNull();
  });

  it("keeps every deadline generous enough to outlast a slow real run", () => {
    // A guard on the numbers themselves: anything under 20 minutes would start
    // killing legitimate jobs on this model.
    for (const ms of Object.values(AI_STALL_DEADLINE_MS)) {
      expect(ms).toBeGreaterThanOrEqual(20 * MINUTE);
    }
    // …and ordered, so a later stage never expires before an earlier one.
    expect(AI_STALL_DEADLINE_MS.finalizing).toBeGreaterThan(AI_STALL_DEADLINE_MS.processing);
  });
});
