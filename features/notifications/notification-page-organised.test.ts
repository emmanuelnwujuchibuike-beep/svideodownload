import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inSections, sectionOf } from "@/features/notifications/notification-center";

/**
 * Owner 2026-10-31: "the notification page looks really cramped and unorganised — the option button squashes with
 * the ring avatar", then "make the dotted option a press and hold, like the chat option — remove the dotted option".
 */
const CARD = readFileSync(join(process.cwd(), "features/notifications/notification-card.tsx"), "utf8");
const CENTER = readFileSync(join(process.cwd(), "features/notifications/notification-center.tsx"), "utf8");

function holdNotDots(src: string): string[] {
  const problems: string[] = [];
  if (/MoreHorizontal/.test(src) || /aria-label="More options"/.test(src)) problems.push("a dotted options button is back on the card");
  if (!/import \{ useLongPress \} from "@\/lib\/dom\/use-long-press"/.test(src)) problems.push("not the chat's own hold");
  if (!/onPointerDown=\{onHoldStart\}/.test(src) || !/onClickCapture=\{hold\.onClickCapture\}/.test(src)) problems.push("the card is not the hold target");
  if (!/\[-webkit-touch-callout:none\]/.test(src)) problems.push("iOS link preview would cover the hold");
  return problems;
}

describe("notifications: press and hold, organised in sections", () => {
  it("opens the card menu on a hold — no dotted button", () => {
    expect(holdNotDots(CARD)).toEqual([]);
  });

  it("has teeth — a dotted button fails", () => {
    expect(holdNotDots(CARD + `\n<button aria-label="More options"><MoreHorizontal /></button>`).length).toBeGreaterThan(0);
    expect(holdNotDots(CARD.replace("onPointerDown={onHoldStart}", "")).length).toBeGreaterThan(0);
  });

  it("the header is one row: title, mark all read, more — no tagline", () => {
    expect(CENTER).toContain('aria-label="Mark all read"');
    expect(CENTER).not.toContain("Everything that happened, in one place");
  });

  it("sections by elapsed time, pinned first, in a fixed order", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
    expect(sectionOf({ createdAt: ago(2) }, now)).toBe("Today");
    expect(sectionOf({ createdAt: ago(30) }, now)).toBe("This week");
    expect(sectionOf({ createdAt: ago(24 * 10) }, now)).toBe("This month");
    expect(sectionOf({ createdAt: ago(24 * 60) }, now)).toBe("Earlier");
    expect(sectionOf({ createdAt: ago(24 * 60), pinned: true }, now)).toBe("Pinned");
    const order = inSections([{ createdAt: ago(24 * 60) }, { createdAt: ago(1) }, { createdAt: ago(5), pinned: true }, { createdAt: ago(3) }], now).map(([k, l]) => `${k}:${l.length}`);
    expect(order).toEqual(["Pinned:1", "Today:2", "Earlier:1"]);
  });
});
