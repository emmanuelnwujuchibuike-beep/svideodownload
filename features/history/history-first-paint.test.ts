import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-10: "the History page always flash this half white on first
  /cold entry". The static /history HTML painted only a 2 px stripe where the
  panel goes, so a cold entry showed header → blank → footer until hydration.
  Asserted on the real build artifact (run after `npm run build`), and on the
  source so a dev run still has teeth.
*/
const built = join(process.cwd(), ".next", "server", "app", "history.html");

describe("/history paints its own layout before the records load", () => {
  it.skipIf(!existsSync(built))("the prerendered HTML already has the search box and the filter chips", () => {
    const html = readFileSync(built, "utf8");
    expect(html).toContain('aria-label="Search downloads"');
    expect(html).toContain("Favorites");
  });

  it("teeth: the not-ready pass no longer returns early for the page hosts", () => {
    const src = readFileSync(join(process.cwd(), "features/history/history-panel.tsx"), "utf8");
    expect(src).toContain("if (!ready && !standalone && !embedded) return null;");
    expect(src).not.toMatch(/if \(!ready\) \{\s*if \(!standalone && !embedded\) return null;/);
  });
});
