import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-14: leaving Feed/Reels through the bottom nav and coming back
 * started at the top, and the profile actions overlapped when a person had sent
 * a request and followed.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("returning to the feed", () => {
  const s = code("features/feed/smart-feed.tsx");

  it("🔴 the unmount save uses the last real scroll, not window.scrollY (already 0 after Next's route scroll)", () => {
    expect(s).toContain("persistContinuity({ scrollY: lastScrollY.current }); // final save on unmount");
    expect(s).not.toContain("persistContinuity(); // final save on unmount");
  });

  it("the restore keeps landing while the restored cards lay out", () => {
    expect(s).toMatch(/tries\+\+ < RESTORE_TRIES\) requestAnimationFrame\(land\)/);
  });

  it("Reels left open inside the feed reopens on return", () => {
    expect(s).toMatch(/if \(reelOpenAt && Date\.now\(\) - reelOpenAt < REEL_RETURN_MS\) setReel\(\{ commentsId: null \}\)/);
  });
});

describe("profile actions with an incoming request", () => {
  it("🔴 Accept/Decline take their own row instead of a single button's share", () => {
    const s = code("features/friends/add-friend-button.tsx");
    expect(s).toContain('<span className="flex w-full flex-none items-center gap-2 sm:w-auto">');
    expect(s).not.toContain('<span className={cn("inline-flex items-center gap-2", className)}>');
  });
});
