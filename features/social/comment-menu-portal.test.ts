import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-14: "comment option hides under an invisible overlay". The ⋯
 * menu was an `absolute` child inside the comment list's `overflow-x-hidden`
 * and the sheet's scroll box, so everything past the list's edge was clipped.
 * The menu and the pin picker now render through a portal on <body>.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("comment ⋯ menu is never clipped", () => {
  const s = code("features/social/comments.tsx");

  it("the menu and the pin picker open through AnchoredMenu, a portal to <body>", () => {
    expect(s).toMatch(/function AnchoredMenu[\s\S]*?createPortal\([\s\S]*?document\.body/);
    expect(s).toMatch(/<AnchoredMenu key="menu" anchor=\{menuAnchorRef\}/);
    expect(s).toMatch(/<AnchoredMenu anchor=\{menuAnchorRef\} onClose=\{\(\) => setPinPickerOpen\(false\)\}>/);
  });

  it("🔴 neither panel is an absolute child that an overflow box can clip", () => {
    expect(s).not.toContain('className="absolute right-0 z-50 mt-1 w-48');
    expect(code("features/social/pin-label-picker.tsx")).not.toContain("absolute right-0 z-50 mt-1");
  });

  it("sits over the comment sheets (z 95/96) and under the toasts (z 100)", () => {
    expect(s).toContain('className="fixed inset-0 z-[98] cursor-default"');
    expect(s).toContain('className="fixed z-[99]"');
  });
});
