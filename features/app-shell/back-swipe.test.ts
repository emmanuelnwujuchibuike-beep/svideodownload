import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-07: "profile menu, profile settings, discovery, search,
 * messages, chat and edit cover always reload or go back twice when back
 * swiping — they should back-swipe like the AI pages that never reload, and
 * go back once."
 *
 * The AI pages (app/(marketing)/ai) never mounted the custom EdgeSwipeBack;
 * the signed-in shell did, so one swipe was handled by the platform AND by the
 * custom gesture. The platform gesture is now the only one. This keeps it so.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function layouts(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...layouts(p));
    else if (e.name === "layout.tsx" || e.name === "template.tsx") out.push(p);
  }
  return out;
}

describe("one back gesture — the platform's", () => {
  it("no layout or template mounts the custom EdgeSwipeBack (it doubled the platform's back)", () => {
    const files = layouts(join(process.cwd(), "app"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/<EdgeSwipeBack\b/);
  });
  it("the signed-in shell says why, so it is not re-added", () => {
    expect(code("app/(app)/layout.tsx")).toContain("NO CUSTOM BACK-SWIPE HERE ANY MORE");
  });
});
