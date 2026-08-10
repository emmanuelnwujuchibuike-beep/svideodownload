import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Select mode must work in EVERY layout (owner, 2026-08-10: "multiple select
 * don't work when I use them").
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 * The gallery renders items through three branches — grouped-by-day, grid, and
 * list — and the first two passed `selection` to their item component while the
 * list did not. So switching to the list layout silently turned the feature
 * off, and every symptom pointed away from the cause: Select still highlighted
 * in the header, the action bar still appeared, and tapping a row opened the
 * item, which reads as taps not registering rather than as a whole layout being
 * unwired.
 *
 * ── Why a source scan ────────────────────────────────────────────────────────
 * There is no DOM environment in this suite, and the defect is structural — a
 * prop missing at one of three call sites. That is precisely what a scan can
 * see and what a unit test of either component could not: both components were
 * individually correct.
 */
const SRC = readFileSync(join(process.cwd(), "features/history/media-gallery.tsx"), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("media gallery — selection reaches every layout", () => {
  const src = stripComments(SRC);

  it("renders items through more than one layout", () => {
    // Guards the check below against passing vacuously if the layouts are ever
    // collapsed into one component.
    const calls = src.match(/<(?:GalleryTile|ListRow)\b/g) ?? [];
    expect(calls.length, "expected several item call sites").toBeGreaterThanOrEqual(3);
  });

  it("passes selection at every item call site", () => {
    /*
      Matched per call site rather than per file: a file-wide "does the word
      appear" check passed happily while one of three branches was unwired.
    */
    const missing: string[] = [];
    for (const match of src.matchAll(/<(GalleryTile|ListRow)\b([\s\S]*?)\/>/g)) {
      if (!/\bselection=/.test(match[2]!)) missing.push(match[1]!);
    }
    expect(
      missing,
      `Item call sites rendered without \`selection\`: ${missing.join(", ")}.\n` +
        `Select mode silently does nothing in that layout.`,
    ).toHaveLength(0);
  });

  it("gives both item components the same selection contract", () => {
    // A tick to see, a toggle to change it, and an announced state. A layout
    // that only draws the tick looks like it works and does not.
    for (const component of ["GalleryTile", "ListRow"]) {
      const start = src.indexOf(`function ${component}(`);
      expect(start, `${component} not found`).toBeGreaterThan(-1);
      const body = src.slice(start, start + 4000);
      expect(body, `${component} does not read selection.active`).toMatch(/selection\?\.active/);
      expect(body, `${component} does not read the picked state`).toMatch(/selection\?\.selected\.has/);
      expect(body, `${component} never toggles`).toMatch(/selection!\.onToggle/);
      expect(body, `${component} does not announce its state`).toMatch(/aria-pressed/);
    }
  });
});
