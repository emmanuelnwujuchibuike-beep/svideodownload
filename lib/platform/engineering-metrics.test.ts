import { describe, expect, it } from "vitest";

import {
  type ChangeEvent,
  changeFailureRate,
  computeReport,
  deploymentsPerDay,
  isFailureSignal,
  meanTimeToRecoveryMs,
} from "./engineering-metrics";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Build events at day offsets from a base, newest-last order irrelevant (sorted internally). */
function ev(subject: string, atMs: number, sha = subject.slice(0, 6)): ChangeEvent {
  return { sha, timestampMs: atMs, subject };
}

describe("isFailureSignal — the classifier that must NOT over-count", () => {
  it("flags reverts, hotfixes and rollbacks", () => {
    expect(isFailureSignal('Revert "feat: x"')).toBe(true);
    expect(isFailureSignal("hotfix: broken login")).toBe(true);
    expect(isFailureSignal("chore: rollback the migration")).toBe(true);
  });
  it("does NOT flag ordinary fix/feat commits (they aren't production failures)", () => {
    expect(isFailureSignal("fix(pwa): clear the safe area")).toBe(false);
    expect(isFailureSignal("feat(platform): event bus")).toBe(false);
    expect(isFailureSignal("refactor: tidy up")).toBe(false);
  });
});

describe("deploymentsPerDay", () => {
  it("averages over the covered span", () => {
    const base = 1_700_000_000_000;
    const events = [0, 1, 2, 3, 4].map((d) => ev(`c${d}`, base + d * DAY));
    // 5 commits spanning 4 days ⇒ 5 / 4 = 1.25/day.
    expect(deploymentsPerDay(events)).toBeCloseTo(1.25, 5);
  });
  it("handles a single commit", () => {
    expect(deploymentsPerDay([ev("only", 1)])).toBe(1);
  });
});

describe("changeFailureRate", () => {
  it("is the share of failure-signal commits", () => {
    const base = 1_700_000_000_000;
    const events = [
      ev("feat: a", base),
      ev("fix(x): b", base + HOUR),
      ev('Revert "feat: a"', base + 2 * HOUR),
      ev("hotfix: c", base + 3 * HOUR),
    ];
    // 2 of 4 are failure signals ⇒ 0.5.
    expect(changeFailureRate(events)).toBe(0.5);
  });
  it("is 0 for an empty set", () => {
    expect(changeFailureRate([])).toBe(0);
  });
});

describe("meanTimeToRecoveryMs", () => {
  it("measures fault → recovery gaps", () => {
    const base = 1_700_000_000_000;
    const events = [
      ev("feat: bad", base),
      ev('Revert "feat: bad"', base + 2 * HOUR), // 2h to recover
    ];
    expect(meanTimeToRecoveryMs(events)).toBe(2 * HOUR);
  });
  it("is null when nothing needed recovery", () => {
    expect(meanTimeToRecoveryMs([ev("feat: a", 1), ev("feat: b", 2)])).toBeNull();
  });
});

describe("computeReport", () => {
  it("assembles the report and marks lead-time honestly", () => {
    const base = 1_700_000_000_000;
    const events = [
      ev("feat: a", base),
      ev("feat: b", base + DAY),
      ev('Revert "feat: b"', base + DAY + 3 * HOUR),
    ];
    const r = computeReport(events);
    expect(r.changes).toBe(3);
    expect(r.leadTime).toBe("needs-signal");
    expect(r.changeFailureRatePct).toBeCloseTo(33.3, 1);
    expect(r.mttrHours).toBe(3);
  });
});
