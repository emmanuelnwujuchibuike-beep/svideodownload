import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-15 (iPhone, Safari): "There is too much white space between the chat
  placeholder and the keyboard, is worst when I open the keyboard."
*/
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the chat composer sits on the keyboard", () => {
  const vv = src("lib/pwa/use-visual-viewport.ts");

  it("🔴 the keyboard is measured against the layout viewport, which the keyboard never shrinks", () => {
    expect(vv).toContain("return Math.max(window.innerHeight, document.documentElement.clientHeight || 0);");
    expect(vv).toContain("const heightGap = layoutViewportHeight() - vv.height;");
    expect(vv).toContain("keyboardOpen: layoutViewportHeight() - vv.height > 120,");
    // teeth: innerHeight alone shrinks with the keyboard on newer iOS Safari, so it must not be the measure
    expect(vv).not.toContain("window.innerHeight - vv.height");
  });

  it("without the keyboard the pad is the home-bar inset minus 8px, not 12px on top of it", () => {
    const room = src("features/social/conversation-room.tsx");
    expect(room).toContain('const composerBottomPad = keyboardOpen ? "pb-2" : "pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.5rem))]";');
    expect(room).not.toContain("pb-[calc(0.75rem+env(safe-area-inset-bottom))]");
  });
});
