import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { FriendRequestItem } from "@/lib/social/friends";

import { ACCEPT_AS, filterRequests, requestContextLine } from "./request-logic";
import { isBuiltInLabel } from "@/lib/social/graph/labels";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const req = (id: string, createdAt: string, mutual: number | null, verified = false, memberSince: string | null = null, source: string | null = null): FriendRequestItem => ({
  id,
  note: null,
  createdAt,
  user: { id: `u-${id}`, handle: id, displayName: id, avatarUrl: null, isVerified: verified },
  context: { mutualFriends: mutual, memberSince, source: source as never },
});

describe("the friend request card (Feature 19 · Part 2)", () => {
  it("says who this is: mutual friends, time on Frenz, where it came from", () => {
    expect(requestContextLine(req("a", "2026-10-09T00:00:00Z", 3, false, "2024-03-01T00:00:00Z", "qr"), NOW)).toEqual([
      "3 mutual friends",
      expect.stringMatching(/^On Frenz since .*2024/),
      "scanned your QR code",
    ]);
    expect(requestContextLine(req("b", "2026-10-09T00:00:00Z", 1, false, "2026-10-01T00:00:00Z"), NOW)).toEqual(["1 mutual friend", "New to Frenz"]);
  });

  it("teeth: no context is invented — zero mutuals and unknown facts say nothing", () => {
    expect(requestContextLine(req("c", "2026-10-09T00:00:00Z", 0), NOW)).toEqual([]);
    expect(requestContextLine({ ...req("d", "2026-10-09T00:00:00Z", null), context: undefined }, NOW)).toEqual([]);
  });

  it("every Accept-as choice is a real built-in relationship label", () => {
    for (const a of ACCEPT_AS) expect(isBuiltInLabel(a.key), a.key).toBe(true);
  });

  it("filters sort and narrow without losing anyone", () => {
    const list = [req("old", "2026-09-01T00:00:00Z", 5), req("new", "2026-10-09T00:00:00Z", 1, true), req("mid", "2026-09-20T00:00:00Z", 9)];
    expect(filterRequests(list, "newest").map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(filterRequests(list, "oldest").map((r) => r.id)).toEqual(["old", "mid", "new"]);
    expect(filterRequests(list, "mutual").map((r) => r.id)).toEqual(["mid", "old", "new"]);
    expect(filterRequests(list, "verified").map((r) => r.id)).toEqual(["new"]);
  });

  it("a block closes the friend graph too: pending requests both ways, and the friendship", () => {
    const code = readFileSync(join(process.cwd(), "app/api/block/[id]/route.ts"), "utf8");
    expect(code).toMatch(/from\("friend_requests"\)\s*\.update\(\{ status: "cancelled"/);
    expect(code).toMatch(/from\("friendships"\)\.delete\(\)/);
  });
});
