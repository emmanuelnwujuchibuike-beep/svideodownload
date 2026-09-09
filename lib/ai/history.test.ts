import { describe, expect, it } from "vitest";

import {
  AI_HISTORY_FILTERS,
  historyChip,
  historyHasActive,
  hoursUntilExpiry,
  isAiHistoryFilter,
  resultAvailability,
  statusesForFilter,
} from "@/lib/ai/history";
import { AI_JOB_STATUSES, type AiJobStatus, type AiJobView } from "@/lib/ai/jobs";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

function job(overrides: Partial<AiJobView> & { status: AiJobStatus }): AiJobView {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    feature: "ai_clean",
    createdAt: "2026-09-09T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    durationMs: null,
    source: { size: null, mimeType: null, durationSeconds: null, name: null, kind: "upload" },
    result: { size: null, durationSeconds: null, audioRestored: null, hasPoster: false },
    error: null,
    ...overrides,
  };
}

describe("statusesForFilter", () => {
  /*
    🔴 The load-bearing one. "All" sending every status by name would go stale
    the moment `ai_jobs` grows an eighth status — silently, because a query that
    lists six of seven returns rows and looks like it worked.
  */
  it("asks for NO statuses on All, so a new status can never be filtered out", () => {
    expect(statusesForFilter("all")).toEqual([]);
  });

  it("narrows Completed to exactly completed", () => {
    expect(statusesForFilter("completed")).toEqual(["completed"]);
  });

  it("puts failed under Cancelled — both are 'no video came out of it'", () => {
    expect([...statusesForFilter("cancelled")].sort()).toEqual(["cancelled", "failed"]);
  });

  it("only ever names statuses the database can hold", () => {
    for (const filter of AI_HISTORY_FILTERS) {
      for (const status of statusesForFilter(filter)) {
        expect(AI_JOB_STATUSES).toContain(status);
      }
    }
  });

  it("recognises its own filters and nothing else", () => {
    for (const f of AI_HISTORY_FILTERS) expect(isAiHistoryFilter(f)).toBe(true);
    expect(isAiHistoryFilter("failed")).toBe(false);
    expect(isAiHistoryFilter("")).toBe(false);
  });
});

describe("resultAvailability", () => {
  it("is ready for a completed job inside its window", () => {
    expect(
      resultAvailability(job({ status: "completed", expiresAt: "2026-09-10T12:00:00.000Z" }), NOW),
    ).toBe("ready");
  });

  /*
    🔴 `completed` is not the same as "playable". Nothing in this project writes
    the `expired` status yet, so the timestamp is the only signal that a file has
    passed its retention window — and offering Play on one hands somebody a
    spinner and then an error for a video we told them we delete.
  */
  it("is expired once the retention window has passed, even while the row says completed", () => {
    expect(
      resultAvailability(job({ status: "completed", expiresAt: "2026-09-09T11:59:59.000Z" }), NOW),
    ).toBe("expired");
  });

  it("treats the exact expiry instant as gone, not as the last playable millisecond", () => {
    expect(
      resultAvailability(job({ status: "completed", expiresAt: "2026-09-09T12:00:00.000Z" }), NOW),
    ).toBe("expired");
  });

  it("is ready when no expiry was ever recorded", () => {
    expect(resultAvailability(job({ status: "completed" }), NOW)).toBe("ready");
  });

  it("is ready rather than expired when the timestamp is unparseable", () => {
    // A malformed value must not delete somebody's video from the interface.
    expect(resultAvailability(job({ status: "completed", expiresAt: "not a date" }), NOW)).toBe("ready");
  });

  it("reports every running status as pending", () => {
    for (const status of ["queued", "acquiring", "processing", "finalizing"] as AiJobStatus[]) {
      expect(resultAvailability(job({ status }), NOW)).toBe("pending");
    }
  });

  it("has no result at all for cancelled and failed", () => {
    expect(resultAvailability(job({ status: "cancelled" }), NOW)).toBe("none");
    expect(resultAvailability(job({ status: "failed" }), NOW)).toBe("none");
  });

  it("covers every status the database can hold", () => {
    for (const status of AI_JOB_STATUSES) {
      expect(["ready", "expired", "pending", "none"]).toContain(
        resultAvailability(job({ status }), NOW),
      );
    }
  });
});

describe("hoursUntilExpiry", () => {
  it("counts whole hours ahead", () => {
    expect(hoursUntilExpiry(job({ status: "completed", expiresAt: "2026-09-10T12:00:00.000Z" }), NOW)).toBe(24);
  });

  it("never says zero — a file still there reads as at least an hour", () => {
    expect(hoursUntilExpiry(job({ status: "completed", expiresAt: "2026-09-09T12:00:30.000Z" }), NOW)).toBe(1);
  });

  it("is null once the window has passed, and null when there is no expiry", () => {
    expect(hoursUntilExpiry(job({ status: "completed", expiresAt: "2026-09-09T11:00:00.000Z" }), NOW)).toBeNull();
    expect(hoursUntilExpiry(job({ status: "completed" }), NOW)).toBeNull();
    expect(hoursUntilExpiry(job({ status: "completed", expiresAt: "0/0" }), NOW)).toBeNull();
  });
});

describe("historyChip", () => {
  it("gives every status a label and a tone", () => {
    for (const status of AI_JOB_STATUSES) {
      const chip = historyChip(job({ status }), NOW);
      expect(chip.label.length).toBeGreaterThan(0);
      expect(["active", "good", "muted", "warn"]).toContain(chip.tone);
    }
  });

  it("says Expired on a completed row whose file has gone", () => {
    const chip = historyChip(job({ status: "completed", expiresAt: "2026-09-08T12:00:00.000Z" }), NOW);
    expect(chip.label).toBe("Expired");
  });

  it("says Ready on a completed row that is still there", () => {
    expect(historyChip(job({ status: "completed", expiresAt: "2026-09-11T12:00:00.000Z" }), NOW).label).toBe(
      "Ready",
    );
  });
});

describe("historyHasActive", () => {
  it("is false for an empty list and for a list of finished jobs", () => {
    expect(historyHasActive([])).toBe(false);
    expect(historyHasActive([job({ status: "completed" }), job({ status: "cancelled" })])).toBe(false);
  });

  /*
    This is what turns the section's poll on and off. `finalizing` was added
    after three hand-written copies of "is this still running" already existed,
    and every one of them stopped polling when the mux began — so it is asserted
    here explicitly rather than assumed from the helper.
  */
  it("is true while any row is still going to change, finalizing included", () => {
    expect(historyHasActive([job({ status: "completed" }), job({ status: "finalizing" })])).toBe(true);
    expect(historyHasActive([job({ status: "queued" })])).toBe(true);
    expect(historyHasActive([job({ status: "processing" })])).toBe(true);
  });
});
