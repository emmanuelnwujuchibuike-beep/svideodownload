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

  it("🔴 2026-10-15: the return lands on the saved POST, not a pixel, with no frame loop (it crawled and missed)", () => {
    expect(s).toContain("restoreStop.current = restoreToAnchor({");
    expect(s).toContain('const loadAnchorRestore = () => import("@/lib/dom/scroll-anchor-restore");');
    expect(s).not.toMatch(/import \{[^}]*restoreToAnchor[^}]*\} from/);
    expect(s).toContain("fallbackY: y,");
    expect(s).not.toMatch(/RESTORE_TRIES|requestAnimationFrame\(land\)/);
    // the reader's post is read when the scroll pauses and saved with the snapshot
    expect(s).toContain("anchorPosRef.current[sortRef.current] = readAnchor(FEED_POST_ATTR, ANCHOR_PROBE_Y, tabScope(sortRef.current));");
    expect(s).toContain("anchor: anchorPosRef.current[sort] ?? null,");
    expect(s).toContain("anchorPosRef.current[snap.sort] = snap.anchor ?? null;");
  });

  it("restored posts appear in place: no fade-in per card, no tab slide while it settles", () => {
    expect(s).toContain("enter={!instant}");
    expect(s).toContain("transition={{ duration: instant ? 0 : 0.22");
    const card = code("features/feed/feed-post-card.tsx");
    expect(card).toContain("data-feed-post={item.id}");
    expect(card).toContain("initial={enter ? { opacity: 0, y: 12 } : false}");
    // no animation end means framer's resting transform must be stripped at mount (fixed video)
    expect(card).toMatch(/if \(!enter && articleRef\.current\) articleRef\.current\.style\.transform = "";/);
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
