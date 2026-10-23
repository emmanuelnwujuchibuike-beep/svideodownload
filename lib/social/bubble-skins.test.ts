import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BUBBLE_SKIN_DATA, BUBBLE_SKIN_SVG } from "./bubble-skins-data";
import { BUBBLE_SKINS, BUBBLE_STYLE_LABEL, BUBBLE_STYLES, bubbleStyleAvailable, effectiveBubbleStyle, PRO_BUBBLE_SKINS } from "./chat-appearance";

// design/frenzsave-bubble-styles.html is the owner's local file and is not in git (CI has no copy, 2026-10-23),
// so these check the data generated from it, never the file itself.
const FOUR_POINT_STAR = "M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z";
const hasFourPointStar = (svgs: readonly string[]) => svgs.some((x) => x.includes(FOUR_POINT_STAR));

describe("bubble skins from design/frenzsave-bubble-styles.html (owner, 2026-10-23)", () => {
  it("every skin in the design is offered, under the design's own name", () => {
    const designIds = BUBBLE_SKIN_DATA.map((s) => [s.id, s.name] as const);
    expect(designIds.length).toBe(21);
    for (const [id, name] of designIds) {
      const ours = id === "default" ? "classic" : id;
      expect(BUBBLE_STYLES as readonly string[], id).toContain(ours);
      expect(BUBBLE_STYLE_LABEL[ours as (typeof BUBBLE_STYLES)[number]]).toBe(name);
    }
    expect([...BUBBLE_SKINS].sort()).toEqual(BUBBLE_SKIN_DATA.map((s) => s.id).filter((id) => id !== "default").sort());
  });

  it("teeth: the design's four-point star is not shipped (never the AI sparkle)", () => {
    expect(hasFourPointStar([`<svg><path d="${FOUR_POINT_STAR}"/></svg>`])).toBe(true); // the check can fail
    expect(hasFourPointStar(Object.values(BUBBLE_SKIN_SVG))).toBe(false);
  });

  it("Halloween skins only in October; a saved one paints as the default afterwards", () => {
    expect(bubbleStyleAvailable("ghost", new Date(2026, 9, 31))).toBe(true);
    expect(bubbleStyleAvailable("ghost", new Date(2026, 10, 1))).toBe(false);
    expect(effectiveBubbleStyle("pumpkin", new Date(2026, 10, 1))).toBe("classic");
    expect(effectiveBubbleStyle("doodle", new Date(2026, 10, 1))).toBe("doodle");
  });

  it("the server refuses the Pro three to a free plan, not just the picker", () => {
    expect([...PRO_BUBBLE_SKINS].sort()).toEqual(["crown", "galaxy", "neon"]);
    const api = readFileSync("app/api/chat-appearance-preferences/route.ts", "utf8");
    expect(api).toContain("PRO_BUBBLE_SKINS as readonly string[]).includes(wanted) && planRank(await getUserPlan(user.id)) < 1");
  });

  it("the chat paints every plain text bubble — mine AND theirs (owner 2026-10-23) — with the skin, never media or a deleted one", () => {
    const room = readFileSync("features/social/conversation-room.tsx", "utf8");
    expect(room).toContain("const skinned = mySkin && !deleted && !frameless && !shared && !hasAttachmentFrame");
    expect(room).not.toContain("const skinned = m.mine && mySkin");
    expect(room).toContain("<SkinDecorations skin={skinned} />");
  });
});
