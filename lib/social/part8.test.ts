import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { anniversaryLine, anniversaryWindow, MAX_YEARS } from "./anniversaries";

// Feature 20 Part 8 — Relationship Celebrations: friendship anniversaries
describe("friendship anniversaries", () => {
  it("finds friendships made on this day, N years ago (one UTC day)", () => {
    const w = anniversaryWindow(new Date(Date.UTC(2026, 9, 12, 3, 30)), 1);
    expect(w).toEqual({ from: "2025-10-12T00:00:00.000Z", to: "2025-10-13T00:00:00.000Z" });
  });
  it("a 29 February friendship is celebrated on 28 February in a common year", () => {
    const w = anniversaryWindow(new Date(Date.UTC(2027, 1, 28)), 3); // 2024 was a leap year
    expect(w).toEqual({ from: "2024-02-28T00:00:00.000Z", to: "2024-03-01T00:00:00.000Z" });
    // teeth: not in a leap year's 28th, the 29th has its own day
    expect(anniversaryWindow(new Date(Date.UTC(2028, 1, 28)), 4).to).toBe("2024-02-29T00:00:00.000Z");
  });
  it("the words, singular and plural", () => {
    expect(anniversaryLine(1)).toBe("You became friends 1 year ago today 🎉");
    expect(anniversaryLine(3)).toBe("You became friends 3 years ago today 🎉");
    expect(MAX_YEARS).toBe(10);
  });
  it("rides the existing daily job — no new schedule — and is bounded and de-duplicated", () => {
    expect(readFileSync("app/api/cron/profile-snapshots/route.ts", "utf8")).toContain("sendFriendAnniversaries()");
    const a = readFileSync("lib/social/anniversaries.ts", "utf8");
    expect(a).toContain("const MAX_SENDS = 500;");
    expect(a).toContain('.eq("type", "milestone").eq("actor_id", them).gte("created_at", todayStart)');
    expect(a).toContain('"low",\n          "social",');
    expect(readFileSync("vercel.json", "utf8")).not.toContain("anniversar");
  });
});

// Feature 20 Part 8 — Smart Social Priority: "Close to you"
describe("Close to you", () => {
  it("the server limits the view to favourite friends and the close friends circle, read only when asked", () => {
    const n = readFileSync("lib/social/notifications.ts", "utf8");
    expect(n).toContain('if (view === "close") {');
    expect(n).toContain('listQuery = listQuery.in("actor_id", ids.slice(0, 500));');
    expect(n).toContain("if (!ids.length) return { groups: [], unread: 0 };");
  });
  it("the Activity Center fetches it only when its tab is open", () => {
    const c = readFileSync("features/notifications/notification-center.tsx", "utf8");
    expect(c).toContain('useQuery<GroupedNotificationsResult>(CLOSE_KEY, loadClose, { enabled: tab === "close"');
    expect(c).toContain('close: "Close to you",');
  });
});
