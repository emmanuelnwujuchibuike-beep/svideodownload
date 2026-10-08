import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 2026-10-07: 0186 applied only up to a COMMENT whose string contained a ";" —
 * the migration runner splits on semicolons without regard to quotes, and the
 * rest of the file (a whole table) was silently skipped. Dollar-quoted bodies
 * ($$ … $$) survive it (0184, 0187 applied whole), quoted strings do not.
 *
 * So: no single-quoted SQL string literal in a migration from 0188 on may
 * contain a semicolon. Older files are history — they ran (or were repaired).
 */
const DIR = join(process.cwd(), "supabase/migrations");

/** Single-quoted literals outside $$ bodies and outside -- comments. */
export function quotedStringsWithSemicolon(sql: string): string[] {
  const outsideDollar = sql.split("$$").filter((_, i) => i % 2 === 0).join("\n");
  const noComments = outsideDollar.replace(/--[^\n]*/g, "");
  const hits: string[] = [];
  for (const m of noComments.matchAll(/'((?:[^']|'')*)'/g)) if (m[1]!.includes(";")) hits.push(m[1]!.slice(0, 80));
  return hits;
}

describe("migrations survive the runner's semicolon split", () => {
  it("the detector has teeth", () => {
    expect(quotedStringsWithSemicolon("comment on column x is 'a; b';")).toEqual(["a; b"]);
    expect(quotedStringsWithSemicolon("create function f() as $$ select 'a; b'; $$;")).toEqual([]);
    expect(quotedStringsWithSemicolon("-- note: 'x; y'\nselect 1;")).toEqual([]);
  });
  it("no migration from 0188 on has a ';' inside a quoted string", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) >= 188);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(quotedStringsWithSemicolon(readFileSync(join(DIR, f), "utf8")), f).toEqual([]);
  });
});

/**
 * 2026-10-07: 0192 reached the runner with three `$$` turned into `$` (a JS
 * String.replace treats `$$` in its replacement as an escaped `$`). Postgres
 * rejected the file — "syntax error at or near $" — and the runner skipped it
 * whole while the next migration applied. A dollar quote is always `$$` (or a
 * named `$tag$`); a lone `$` outside a quoted string is never valid here.
 */
export function loneDollars(sql: string): number[] {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const bad: number[] = [];
  noComments.split("\n").forEach((line, i) => {
    const stripped = line.replace(/'(?:[^']|'')*'/g, "''").replace(/\$[A-Za-z_]*\$/g, "");
    if (stripped.includes("$")) bad.push(i + 1);
  });
  return bad;
}

describe("dollar quotes are whole", () => {
  it("the detector has teeth", () => {
    expect(loneDollars("create function f() returns int as $\nselect 1\n$;")).toEqual([1, 3]);
    expect(loneDollars("create function f() returns int as $$\nselect 1\n$$;\ndo $tag$ begin end $tag$;")).toEqual([]);
    expect(loneDollars("select 'costs $5';")).toEqual([]);
  });
  it("no migration from 0188 on has a lone $", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) >= 188);
    for (const f of files) expect(loneDollars(readFileSync(join(DIR, f), "utf8")), f).toEqual([]);
  });
});
