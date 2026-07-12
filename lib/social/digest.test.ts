import { describe, expect, it } from "vitest";

import { formatDigestBody, isDigestEligible, type DigestSettingsRow, type DigestStats } from "./digest";

const empty: DigestStats = { newFollowers: 0, newComments: 0, newFriendRequests: 0, downloadsCompleted: 0, totalCount: 0 };
const NOW = new Date("2026-07-13T12:00:00Z").getTime();

describe("formatDigestBody", () => {
  it("returns null when there's nothing to report — never sends a filler digest", () => {
    expect(formatDigestBody(empty)).toBeNull();
  });

  it("formats a single stat without a comma", () => {
    expect(formatDigestBody({ ...empty, newFollowers: 3, totalCount: 3 })).toBe("You have 3 new followers.");
  });

  it("uses singular for exactly one", () => {
    expect(formatDigestBody({ ...empty, newFollowers: 1, totalCount: 1 })).toBe("You have 1 new follower.");
  });

  it("joins two stats with 'and', no oxford comma needed", () => {
    expect(formatDigestBody({ ...empty, newFollowers: 2, newComments: 1, totalCount: 3 })).toBe("You have 2 new followers and 1 new comment.");
  });

  it("joins three+ stats with commas and a final 'and'", () => {
    const stats: DigestStats = { newFollowers: 12, newComments: 8, newFriendRequests: 5, downloadsCompleted: 0, totalCount: 25 };
    expect(formatDigestBody(stats)).toBe("You have 12 new followers, 8 new comments, and 5 friend requests.");
  });

  it("includes all four categories when all are present", () => {
    const stats: DigestStats = { newFollowers: 1, newComments: 1, newFriendRequests: 1, downloadsCompleted: 3, totalCount: 6 };
    const body = formatDigestBody(stats);
    expect(body).toContain("1 new follower");
    expect(body).toContain("1 new comment");
    expect(body).toContain("1 friend request");
    expect(body).toContain("3 downloads finished");
  });
});

describe("isDigestEligible", () => {
  it("is eligible when no settings row exists — defaults apply", () => {
    expect(isDigestEligible(undefined, NOW, 20)).toBe(true);
  });

  it("is never eligible when digest is explicitly disabled", () => {
    const row: DigestSettingsRow = { digest_enabled: false, last_digest_sent_at: null };
    expect(isDigestEligible(row, NOW, 20)).toBe(false);
  });

  it("is eligible when enabled and never sent before", () => {
    const row: DigestSettingsRow = { digest_enabled: true, last_digest_sent_at: null };
    expect(isDigestEligible(row, NOW, 20)).toBe(true);
  });

  it("is NOT eligible when the last digest was sent within the window", () => {
    const row: DigestSettingsRow = { digest_enabled: true, last_digest_sent_at: new Date(NOW - 5 * 60 * 60_000).toISOString() }; // 5h ago
    expect(isDigestEligible(row, NOW, 20)).toBe(false);
  });

  it("IS eligible once the last digest is older than the window", () => {
    const row: DigestSettingsRow = { digest_enabled: true, last_digest_sent_at: new Date(NOW - 25 * 60 * 60_000).toISOString() }; // 25h ago
    expect(isDigestEligible(row, NOW, 20)).toBe(true);
  });

  it("boundary: exactly at the cutoff is NOT yet eligible (strict less-than)", () => {
    const row: DigestSettingsRow = { digest_enabled: true, last_digest_sent_at: new Date(NOW - 20 * 60 * 60_000).toISOString() }; // exactly 20h ago
    expect(isDigestEligible(row, NOW, 20)).toBe(false);
  });
});
