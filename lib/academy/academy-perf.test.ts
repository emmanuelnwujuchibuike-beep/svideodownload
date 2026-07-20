import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Academy's bundle split, pinned.
 *
 * ── The regression this exists to catch ───────────────────────────────────────
 *
 * Course self-checks shipped with the question corpus imported directly by the
 * component the school page renders. Measured on the build, `/academy/[school]`
 * went from 1.12 kB / 260 kB to 10.5 kB / 275 kB of first-load JS — 15 kB
 * delivered to every reader of a static content page for a quiz that is
 * collapsed by default and that most of them never open.
 *
 * Nothing failed. The page rendered correctly, every unit test passed, the
 * perf-budget ratchet has headroom at 300 kB so it stayed green, and the only
 * way it surfaced was building the branch twice and comparing the numbers.
 * That is not a check anyone will remember to run, hence this file.
 *
 * ── What is actually being asserted ───────────────────────────────────────────
 *
 * `course-check.tsx` renders on first paint, so it must stay free of the corpus
 * and reach the panel only through a lazy `import()`. `course-check-panel.tsx`
 * is the lazy chunk and may import whatever it needs. The rule is about which
 * module the import lives in, which is exactly what a source scan can see.
 */

const FEATURES = path.resolve(__dirname, "../../features/academy");

function read(file: string): string {
  return readFileSync(path.join(FEATURES, file), "utf8");
}

describe("Academy — bundle split", () => {
  const trigger = read("course-check.tsx");
  const panel = read("course-check-panel.tsx");

  it("keeps the question corpus out of the eagerly-rendered trigger", () => {
    // The 15 kB. Static `import ... from ".../assessments"` at the top of this
    // module puts every question in the school page's first load.
    expect(trigger, "course-check.tsx statically imports the assessment corpus").not.toMatch(
      /^import\s[^;]*from\s+["']@\/lib\/academy\/assessments["']/m,
    );
    expect(trigger).not.toMatch(/^import\s[^;]*from\s+["']\.\/assessments["']/m);
  });

  it("reaches the panel through a lazy import, not a static one", () => {
    expect(trigger, "the panel must be code-split").toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\(["']\.\/course-check-panel["']\)\s*\)/,
    );
    expect(trigger, "a static import of the panel defeats the split").not.toMatch(
      /^import\s+\w+\s+from\s+["']\.\/course-check-panel["']/m,
    );
  });

  it("takes the question count as a prop rather than counting the corpus", () => {
    /*
     * The subtle version of the same regression: importing the corpus purely to
     * read `questions.length` for the button label costs the entire 15 kB to
     * save passing one number from a server component.
     */
    expect(trigger).toMatch(/questionCount/);
  });

  it("keeps the corpus in the lazy chunk, where it belongs", () => {
    // The inverse check — if this ever fails, the panel stopped being the thing
    // that owns the corpus and the split has been rearranged without updating
    // the reasoning above.
    expect(panel).toMatch(/from\s+["']@\/lib\/academy\/assessments["']/);
  });

  it("renders the panel only behind a Suspense boundary", () => {
    // A lazy component rendered without one throws at runtime the first time a
    // reader opens the check — and only then, which is the worst time to find out.
    expect(trigger).toMatch(/<Suspense/);
  });
});
