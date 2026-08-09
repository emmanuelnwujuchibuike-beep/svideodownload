import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * No source file may contain raw control characters.
 *
 * ── Why this test exists ──────────────────────────────────────────────────────
 * On 2026-08-09 a shell heredoc ate the backslashes out of
 * `/\b(?:404|403|401|410)\b/`, leaving two literal BACKSPACE bytes where the
 * word boundaries belonged. The result was a perfectly valid regex that could
 * only ever match a control character — so it matched nothing, and settled
 * failures were retried three times each on a quota-metered endpoint.
 *
 * It compiled. It type-checked. It linted. It built. It deployed. It is
 * invisible in an editor, and most tools render the byte back as a harmless
 * `\b`. The only thing that can see it is something that reads the bytes.
 *
 * ── What is checked, and what isn't ───────────────────────────────────────────
 * Tab (0x09), newline (0x0a) and carriage return (0x0d) are legitimate and
 * excluded. Everything else below 0x20 is not: BACKSPACE, BEL, vertical tab,
 * form feed and the escape byte have no business in a TypeScript file, and each
 * one arrives the same way — through a shell that interpreted an escape nobody
 * meant it to.
 *
 * Tracked files only (`git ls-files`), so build output and dependencies are out
 * of scope by construction rather than by an ignore list that would drift.
 */

/** Control bytes that are never legitimate in source. Tab/LF/CR are excluded. */
const FORBIDDEN = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x0f, 0x1a, 0x1b,
];

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json|sql)$/;

function trackedSourceFiles(): string[] {
  try {
    return execSync("git ls-files", { maxBuffer: 1e8 })
      .toString()
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && SOURCE.test(f));
  } catch {
    return [];
  }
}

describe.skipIf(trackedSourceFiles().length === 0)("source integrity", () => {
  it("contains no raw control characters", () => {
    const offenders: string[] = [];

    for (const file of trackedSourceFiles()) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        continue; // deleted between listing and reading
      }
      const found = FORBIDDEN.filter((c) => bytes.includes(c));
      if (found.length === 0) continue;

      // Name the LINE as well as the file — the whole difficulty with this
      // class of fault is that you cannot see it once you open the file.
      const lines: string[] = [];
      bytes
        .toString("latin1")
        .split("\n")
        .forEach((line, i) => {
          if (FORBIDDEN.some((c) => line.includes(String.fromCharCode(c)))) {
            lines.push(`      line ${i + 1}`);
          }
        });
      offenders.push(`${file} [${found.map((c) => `0x${c.toString(16).padStart(2, "0")}`).join(", ")}]\n${lines.join("\n")}`);
    }

    expect(
      offenders,
      `Raw control bytes in source:\n  ${offenders.join("\n  ")}\n\n` +
        `A shell almost certainly ate a backslash while the line was written — a \`\\b\` ` +
        `became a literal BACKSPACE, a \`\\t\` became a TAB, and so on. The code will look ` +
        `correct and behave differently. Rewrite the line with an editor or a script FILE, ` +
        `never through a heredoc or \`node -e "…"\`.`,
    ).toEqual([]);
  });
});
