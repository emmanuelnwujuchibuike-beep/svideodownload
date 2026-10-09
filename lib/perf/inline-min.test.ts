import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { minifyInline } from "@/lib/perf/inline-min";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The template literal assigned to `name` in a source file. */
function literal(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`no ${name}`);
  return m[1]!;
}

describe("inline scripts and styles ship without their comments", () => {
  const tap = literal(code("features/app-shell/pending-tap.tsx"), "PENDING_TAP_JS");
  const splashCss = literal(code("features/app-shell/boot-splash.tsx"), "CSS");

  it("the pending-tap script still parses after squeezing, and loses most of its weight", () => {
    const out = minifyInline(tap);
    expect(() => new Function(out)).not.toThrow();
    expect(out).not.toMatch(/\/\*/);
    expect(out.length).toBeLessThan(tap.length * 0.75);
  });

  it("the splash CSS keeps every rule (same braces) and drops the notes", () => {
    const out = minifyInline(splashCss);
    expect(out).not.toMatch(/\/\*/);
    expect(out.split("{").length).toBe(splashCss.replace(/\/\*[\s\S]*?\*\//g, "").split("{").length);
    expect(out.length).toBeLessThan(splashCss.length * 0.5);
  });

  it("what is SENT is the squeezed copy", () => {
    expect(code("features/app-shell/pending-tap.tsx")).toContain("__html: PENDING_TAP_SENT");
    expect(code("features/app-shell/boot-splash.tsx")).toContain("__html: CSS_SENT");
  });

  it("teeth: a comment marker inside a string would be caught by the parse check", () => {
    const broken = minifyInline('var a = "/* x"; var b = 1; /* y */ var c = "*/";');
    expect(() => new Function(broken)).toThrow();
  });
});
