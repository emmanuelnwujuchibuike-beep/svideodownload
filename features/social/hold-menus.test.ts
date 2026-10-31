import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const room = readFileSync("features/social/conversation-room.tsx", "utf8");
const header = readFileSync("features/social/thread-header.tsx", "utf8");
const pymk = readFileSync("features/friends/people-you-may-know.tsx", "utf8");

// Owner, 2026-10-31: hold the chat's empty background → the chat options (the top ⋯ stays); suggestion rows lose their ⋯
// for a press and hold, and get a small glass Follow in its place.
function holds(r: string, h: string, p: string): boolean {
  return (
    /if \(onBackground\(e\.target\)\) holdBackground\.onPointerDown\(e\);/.test(r) &&
    /closest\?\.\("\[data-message-id\], button, a, input, textarea, img, video/.test(r) &&
    /window\.addEventListener\(CHAT_OPTIONS_EVENT, open\);/.test(h) &&
    /aria-label="Conversation options"/.test(h) &&
    !/MoreHorizontal/.test(p) &&
    /const hold = useLongPress\(\(\) => setMenu\(true\)\);/.test(p) &&
    /iconOnly \/>/.test(p)
  );
}

describe("press-and-hold menus", () => {
  it("holds", () => {
    expect(holds(room, header, pymk)).toBe(true);
  });
  it("has teeth", () => {
    expect(holds(room.replace("if (onBackground(e.target)) holdBackground.onPointerDown(e);", "holdBackground.onPointerDown(e);"), header, pymk)).toBe(false);
    expect(holds(room, header.replace('aria-label="Conversation options"', 'aria-label="x"'), pymk)).toBe(false);
    expect(holds(room, header, pymk + "\nimport { MoreHorizontal } from 'lucide-react';")).toBe(false);
  });
});
