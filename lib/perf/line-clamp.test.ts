import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `line-clamp-N` and `block` CANCEL EACH OTHER — never write both.
 *
 * ── The bug (owner, 2026-08-09) ──────────────────────────────────────────────
 * "media caption in history page shouldn't show everything, it should only show
 * one line with three dots."
 *
 * The history grid tile already said `line-clamp-1 block`, so it looked correct
 * in review. It is not. `line-clamp-1` works by setting
 * `display: -webkit-box`; `block` sets `display: block`. Both are single-class
 * selectors, so specificity ties and the LATER rule in the stylesheet wins —
 * and Tailwind emits `.block` after `.line-clamp-*`:
 *
 *     .line-clamp-1 { overflow: hidden; display: -webkit-box;
 *                     -webkit-box-orient: vertical; -webkit-line-clamp: 1 }
 *     .block        { display: block }
 *
 * (Verified by running the Tailwind CLI over exactly those two classes, not by
 * reading the docs.)
 *
 * So the clamp was dead. A downloaded TikTok slideshow stores the whole caption
 * as its `title`, and it rendered in full over every thumbnail in the grid.
 *
 * ── Why this needs a test ────────────────────────────────────────────────────
 * It produces no error, no warning and no type failure. It compiles, it lints,
 * it builds, and the only symptom is text that is longer than intended — which
 * is invisible until a caption happens to be long. Same family as the
 * undefined-colour-token bug: a class string that silently does nothing.
 *
 * `line-clamp-N` is already block-level, so dropping `block` is always the fix.
 */
const ROOTS = ["app", "components", "features"];
const EXT = /\.tsx$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

/** Every `className="…"` / `className={"…"}` string literal in the file. */
function classStrings(src: string): string[] {
  return [...src.matchAll(/"([^"\n]*\b(?:line-clamp-\d+|block)\b[^"\n]*)"/g)].map((m) => m[1]!);
}

describe("line-clamp is never cancelled by `block`", () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  it("scans a meaningful number of components", () => {
    // Guards against the walker silently finding nothing and passing.
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no class string containing both", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const cls of classStrings(readFileSync(file, "utf8"))) {
        const hasClamp = /(?:^|\s)line-clamp-\d+(?:\s|$)/.test(cls);
        // Only the bare `block` collides. Responsive/variant forms like
        // `sm:block` or `lg:block` apply under their own conditions and are a
        // deliberate choice, not this mistake.
        const hasBlock = /(?:^|\s)block(?:\s|$)/.test(cls);
        if (hasClamp && hasBlock) {
          offenders.push(`${file.replace(process.cwd(), "").replace(/\\/g, "/")}\n    ${cls}`);
        }
      }
    }
    expect(
      offenders,
      `\`block\` overrides the \`display: -webkit-box\` that line-clamp needs — drop \`block\`:\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });
});
