import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nav = readFileSync("features/app-shell/mobile-nav.tsx", "utf8");
const drag = readFileSync("features/app-shell/nav-drag.ts", "utf8");

// Owner, 2026-10-31: the glass nav "must not break fast navigation" nor "the landing weight or lcp".
function safe(navSrc: string, dragSrc: string): boolean {
  return (
    // the drag module is never a static import of the nav (it would ship on every cold entry)
    !/^import [^;]*nav-drag/m.test(navSrc) &&
    /import\("@\/features\/app-shell\/nav-drag"\)/.test(navSrc) &&
    // and it loads after the page has loaded, when idle
    /document\.readyState === "complete"/.test(navSrc) &&
    /requestIdleCallback/.test(navSrc) &&
    // a tap stays the link's own: capture only after the slop, a drag opens the tab by clicking its real link
    /if \(Math\.abs\(e\.clientX - startX\) < SLOP\) return;\s*moved = true;\s*try \{\s*nav\.setPointerCapture/.test(dragSrc) &&
    /if \(!dragged\) return;/.test(dragSrc) &&
    /target\?\.click\(\);/.test(dragSrc) &&
    !/router\.push|location\.(href|assign)/.test(dragSrc)
  );
}

describe("the glass nav's press & drag", () => {
  it("never weighs on a cold entry and never gets in a tap's way", () => {
    expect(safe(nav, drag)).toBe(true);
  });

  it("has teeth", () => {
    expect(safe('import { attachNavDrag } from "@/features/app-shell/nav-drag";\n' + nav, drag)).toBe(false);
    expect(safe(nav.replace('document.readyState === "complete"', "true"), drag)).toBe(false);
    expect(safe(nav, drag.replace("if (!dragged) return;", ""))).toBe(false);
    expect(safe(nav, drag.replace("target?.click();", "router.push(target.href);"))).toBe(false);
    expect(safe(nav, drag.replace("if (Math.abs(e.clientX - startX) < SLOP) return;", ""))).toBe(false);
  });
});
