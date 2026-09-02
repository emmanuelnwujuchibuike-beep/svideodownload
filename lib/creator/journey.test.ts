import { describe, expect, it } from "vitest";

import { buildCreatorJourney, nextMilestone, type JourneySignals } from "@/lib/creator/journey";

const NEW: JourneySignals = {
  joinedAt: "2026-01-01T00:00:00.000Z",
  firstPost: null,
  topPost: null,
  totalViews: 0,
  followers: 0,
  totalPosts: 0,
  firstFollowerAt: null,
  isVerified: false,
  verifiedAt: null,
  soundsPublished: 0,
  firstSoundAt: null,
};

const ESTABLISHED: JourneySignals = {
  joinedAt: "2025-03-04T00:00:00.000Z",
  firstPost: { id: "p1", title: "First one", createdAt: "2025-03-10T00:00:00.000Z", thumbnailUrl: "/a.jpg" },
  topPost: { id: "p9", title: "The big one", views: 240_000, createdAt: "2026-02-02T00:00:00.000Z", thumbnailUrl: "/b.jpg" },
  totalViews: 1_400_000,
  followers: 12_500,
  totalPosts: 210,
  firstFollowerAt: "2025-03-11T00:00:00.000Z",
  isVerified: true,
  verifiedAt: "2026-01-15T00:00:00.000Z",
  soundsPublished: 3,
  firstSoundAt: "2025-09-01T00:00:00.000Z",
};

const step = (s: JourneySignals, key: string) => buildCreatorJourney(s).find((x) => x.key === key)!;

describe("buildCreatorJourney", () => {
  it("always starts with a dated join", () => {
    const steps = buildCreatorJourney(NEW);
    expect(steps[0]!.key).toBe("joined");
    expect(steps[0]!.date).toBe(NEW.joinedAt);
    expect(steps[0]!.reached).toBe(true);
  });

  it("gives a brand-new creator a full ladder of locked steps, not an empty page", () => {
    const steps = buildCreatorJourney(NEW);
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.filter((s) => !s.reached).length).toBeGreaterThan(4);
  });

  it("dates the first upload from the post's own row", () => {
    const s = step(ESTABLISHED, "first-upload");
    expect(s.reached).toBe(true);
    expect(s.date).toBe("2025-03-10T00:00:00.000Z");
    expect(s.thumbnailUrl).toBe("/a.jpg");
  });

  it("dates the first follower, because follows.created_at is a real row", () => {
    expect(step(ESTABLISHED, "first-follower").date).toBe("2025-03-11T00:00:00.000Z");
  });

  it("🔴 reports a crossed VIEW milestone WITHOUT a date, because no row records when", () => {
    // views_count is a running counter — it does not remember the day it passed
    // 100. Reached must therefore be true and date must be absent, never a
    // plausible-looking guess.
    const s = step(ESTABLISHED, "views-100");
    expect(s.reached).toBe(true);
    expect(s.date).toBeUndefined();
  });

  it("🔴 reports a crossed FOLLOWER milestone without a date either", () => {
    const s = step(ESTABLISHED, "followers-1000");
    expect(s.reached).toBe(true);
    expect(s.date).toBeUndefined();
  });

  it("names the best post as the best post, never as 'went viral'", () => {
    const s = step(ESTABLISHED, "best-post");
    expect(s.title).toMatch(/best post/i);
    expect(s.title).not.toMatch(/viral/i);
    expect(s.date).toBe("2026-02-02T00:00:00.000Z");
  });

  it("omits the best-post step entirely when there are no posts", () => {
    expect(buildCreatorJourney(NEW).find((s) => s.key === "best-post")).toBeUndefined();
  });

  it("omits the sound step for a creator who has published none", () => {
    expect(buildCreatorJourney(NEW).find((s) => s.key === "first-sound")).toBeUndefined();
    expect(step(ESTABLISHED, "first-sound").reached).toBe(true);
  });

  it("reports verification with its real grant date", () => {
    const s = step(ESTABLISHED, "verified");
    expect(s.reached).toBe(true);
    expect(s.date).toBe("2026-01-15T00:00:00.000Z");
  });

  it("locks verification for a creator who is not verified", () => {
    const s = step({ ...ESTABLISHED, isVerified: false, verifiedAt: null }, "verified");
    expect(s.reached).toBe(false);
    expect(s.date).toBeUndefined();
  });

  it("🔴 keeps verification REACHED when it has no request row to date it", () => {
    // Verified before migration 0104, or granted by an admin on the profile
    // row directly: `is_verified` is the authority on WHETHER, and there is
    // simply no date. Showing them as unverified would contradict their own
    // profile badge.
    const s = step({ ...ESTABLISHED, isVerified: true, verifiedAt: null }, "verified");
    expect(s.reached).toBe(true);
    expect(s.date).toBeUndefined();
  });

  it("counts down the real distance to a locked milestone", () => {
    const s = step({ ...NEW, totalViews: 60 }, "views-100");
    expect(s.reached).toBe(false);
    expect(s.detail).toContain("40");
    expect(s.progress).toBeCloseTo(0.6, 5);
  });

  it("keeps progress inside 0-1 even when far past the target", () => {
    for (const s of buildCreatorJourney(ESTABLISHED)) {
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
    }
  });

  it("marks the first follower reached when the count is positive but the date is missing", () => {
    // A follow row predating the column, or a deleted follower — the count is
    // still proof it happened, so the milestone stands without a date.
    const s = step({ ...ESTABLISHED, firstFollowerAt: null, followers: 40 }, "first-follower");
    expect(s.reached).toBe(true);
    expect(s.date).toBeUndefined();
  });
});

describe("nextMilestone", () => {
  it("is the first unreached rung", () => {
    const next = nextMilestone(buildCreatorJourney({ ...NEW, totalViews: 150, firstPost: NEW.firstPost }));
    expect(next).not.toBeNull();
    expect(next!.reached).toBe(false);
  });

  it("is null once the whole ladder is done", () => {
    const finished: JourneySignals = {
      ...ESTABLISHED,
      totalViews: 5_000_000,
      followers: 2_000_000,
    };
    expect(nextMilestone(buildCreatorJourney(finished))).toBeNull();
  });
});
