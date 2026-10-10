import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE BLACK BANDS ABOVE AND BELOW THE MEDIA (owner, 2026-10-04)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "History and story viewer still show the bottom and top black chrome
 * instead of the media covering all except the safe area."
 *
 * Both viewers used `object-contain` unconditionally, so a 9:16 clip on a
 * 9:19.5 phone sat in a black sandwich. The fix is not `object-cover`
 * everywhere — that would crop a landscape video down to a sliver. The SHAPE
 * OF THE SOURCE decides, measured from the file:
 *
 *     portrait  (h > w)  → cover
 *     square / landscape → contain
 *
 * 🔴 The point of this file is that the two viewers give the SAME answer.
 * `download-player.tsx`'s own comment says they must not "drift into two
 * different answers to the same question", and before this they already had:
 * one letterboxed, and nothing enforced the pair.
 */

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const VIEWERS = [
  "features/downloads/download-player.tsx",
  "features/app-shell/dashboard/stories-row.tsx",
];

describe("both viewers fill the frame for portrait media", () => {
  it.each(VIEWERS)("%s chooses cover/contain from the measured shape", (rel) => {
    const s = src(rel);
    expect(s).toContain('fillFrame ? "object-cover" : "object-contain"');
    // measured, never assumed from the platform or the record's own metadata
    expect(s).toMatch(/videoHeight > e\.currentTarget\.videoWidth|naturalHeight > e\.currentTarget\.naturalWidth/);
  });

  it.each(VIEWERS)("%s no longer hardcodes object-contain on the stage", (rel) => {
    /*
      Teeth: the regression is a single literal coming back. A stage element
      pinned to `object-contain` is exactly the reported bug, and it would
      otherwise sit happily beside the conditional above.
    */
    const s = src(rel);
    expect(s).not.toContain('className="h-full w-full object-contain"');
    expect(s).not.toContain('className="h-full w-full bg-black object-contain"');
  });

  it.each(VIEWERS)("%s resets the verdict between items, so a shape cannot leak", (rel) => {
    expect(src(rel)).toContain("setFillFrame(false)");
  });

  it("the media still stops at the safe area — filling must not mean full-bleed", () => {
    /*
      The owner's rule has two halves and only one of them is about filling:
      "the media should not cross the safe area". Both viewers keep their
      top inset; the chrome floats on the picture instead.
    */
    expect(src("features/downloads/download-player.tsx")).toContain("pt-[var(--frenz-safe-top)]");
    expect(src("features/app-shell/dashboard/stories-row.tsx")).toContain('top: "var(--frenz-safe-top, 0px)"');
  });
});

describe("entering /history shows the stripe, never a white screen", () => {
  const panel = src("features/history/history-panel.tsx");

  it("the not-ready state is the shared LoadingStripe", () => {
    /*
      Owner: "instead of the white screen the skeleton stripe loader should
      show or nothing should show."

      An earlier pass fixed the block skeleton's CONTRAST (it painted at
      ~97.7% on a 98% background). That was real, but a screenful of grey
      furniture is still the wrong answer for a wait that is HYDRATION — the
      page is `force-static` and the store reads localStorage.
    */
    expect(panel).toContain("<LoadingStripe />");
    expect(panel).toContain('from "@/features/ui/page-loader"');
  });

  it("the invisible block skeleton is gone for good", () => {
    /*
      Scoped to the not-ready branch: `bg-secondary/70` is legitimate
      elsewhere in this file (the kind-filter pills), and a whole-file match
      would fail on code that was never part of the bug.
    */
    // 2026-10-10: the not-ready state is now the grid slot only (the page's layout paints around it)
    const start = panel.indexOf("{!ready ? (");
    expect(start).toBeGreaterThan(-1);
    const branch = panel.slice(start, panel.indexOf("<MediaGallery", start));
    // the tint that caused the original report, and the grid of tiles that replaced it
    expect(branch).not.toContain("bg-secondary/");
    expect(branch).not.toContain("Array.from({ length: 12 }");
    expect(branch).not.toContain("animate-pulse");
  });
});

describe("the upgrade card has a narrow layout", () => {
  const card = src("features/monetization/result-offer.tsx");

  it("stacks on a phone and only becomes a row when there is room", () => {
    /*
      It was `flex items-center` with three children and no wrapping, so the
      text column got whatever was left after a 48px icon and a button that
      would not shrink — about 150px, which broke the title mid-phrase and ran
      the body to six ragged lines.
    */
    expect(card).toContain("flex flex-col gap-4 sm:flex-row sm:items-center");
    expect(card).toContain("w-full shrink-0 items-center justify-center");
    expect(card).toContain("sm:w-auto");
  });

  it("the action clears the 44px tap target", () => {
    expect(card).toContain("min-h-[2.75rem]");
  });
});
