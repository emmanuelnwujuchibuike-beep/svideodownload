import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHERE THE STREAK CHIP IS ALLOWED TO APPEAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "it should be on the landing page and it should not show
 * on other pages top header only the landing page, profile page and the
 * download page."
 *
 * A source-integrity test, like lib/ai/config.test.ts, because the thing worth
 * protecting is not the component's output — it is two structural properties
 * that are invisible in review and expensive when they rot:
 *
 *   1. the route list, which is a product decision and has already been wrong
 *      twice (mounted in one header, then in a desktop-only cluster);
 *   2. the ORDER of the gate against the hooks, which is what keeps the rule
 *      free on the ~40 routes it excludes.
 *
 * Rendering the component would test neither: both survive a passing render.
 */
const SRC = readFileSync(
  join(process.cwd(), "features/streaks/streak-header-chip.tsx"),
  "utf8",
);

/**
 * 🔴 THE ORDERING TEST ANCHORS ON A CALL SITE, NOT ON A NAME.
 *
 * It compares character offsets, and the component documents its own reasoning
 * in prose that NAMES the identifiers being ordered — so the first `useStreak()`
 * in the raw text is the one inside a comment explaining why the gate precedes
 * it. Measuring that is measuring the documentation.
 *
 * The first attempt stripped comments with a regex; this one just anchors on
 * `const { data } = useStreak();`, the actual call, which no prose contains.
 * Fewer moving parts and nothing to get wrong when somebody rewords a
 * paragraph.
 *
 * Caught by the test failing on its first run, which is the correct outcome for
 * an assertion that would otherwise have passed for the wrong reason.
 */
const CALL_SITE = "const { data } = useStreak();";

describe("the route list", () => {
  it("🔴 is exactly landing, profile and downloads", () => {
    const decl = SRC.match(/const STREAK_ROUTES = new Set\(\[([^\]]*)\]\)/);
    const body = decl?.[1];
    expect(body, "STREAK_ROUTES declaration").toBeTypeOf("string");

    const routes = [...(body ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(routes).toEqual(["/", "/downloads", "/profile"]);
  });

  it("does not reach for a prefix match", () => {
    /*
      `/u/<handle>` is somebody ELSE's profile and `startsWith("/profile")`
      would also light up on any future /profile-* route. Exact membership is
      the rule; a Set lookup is what enforces it.
    */
    expect(SRC).toContain("STREAK_ROUTES.has(route)");
    expect(SRC).not.toMatch(/startsWith\(\s*"\/profile"/);
  });
});

describe("the gate runs before the hooks", () => {
  it("returns null before useStreak() can be reached", () => {
    /*
      Hooks cannot live behind a condition, so a gate written inside the chip
      would necessarily run AFTER `useStreak()`. The split into an outer gate
      and an inner `StreakChip` is what keeps the rule ahead of them, and this
      pins that ordering.

      ⚠️ It is NOT a request saving, though an earlier version of this comment
      said so. Measured on a production build 2026-09-08: /api/streak is fetched
      twice on every route regardless, by `StreakTracker` in the app-wide
      deferred shell — and `useQuery` de-dupes by key, so a second consumer is
      free. What this pins is one subscriber and one localStorage read fewer on
      the ~40 excluded routes, plus a shape the rule cannot be misplaced in.
    */
    const gate = SRC.indexOf("STREAK_ROUTES.has(route)");
    const fetchHook = SRC.indexOf(CALL_SITE);
    expect(gate).toBeGreaterThan(-1);
    expect(fetchHook).toBeGreaterThan(-1);
    expect(gate, "the route gate must precede useStreak()").toBeLessThan(fetchHook);
  });

  it("keeps the hooks in a component the gate can decline to render", () => {
    expect(SRC).toMatch(/function StreakChip\(/);
    expect(SRC).toMatch(/return <StreakChip className=\{className\} \/>;/);
  });
});

describe("a visitor with no streak", () => {
  it("still renders nothing, so the header cannot shift", () => {
    // Zero-CLS discipline: the pill either paints in the first client render
    // from the localStorage cache, or never. It must not appear when a fetch
    // resolves — that is a layout shift in a header, above the fold, on every
    // route that carries it.
    expect(SRC).toContain("if (streak <= 0) return null;");
    expect(SRC).toContain("readDisplayCache()");
  });
});
