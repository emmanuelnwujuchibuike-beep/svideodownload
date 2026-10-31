import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31: "the feed and friends page now shows the gap on every navigation". The app loads two stylesheets:
  app.css and — after any visit to a marketing-group page (History, AI, support…) — entry.css. entry.css has `.sticky`
  and no `max-lg:` rules, so when it loaded AFTER app.css its `.sticky` beat the header's `max-lg:fixed` and the
  floating header fell back into the page on top of its own spacer (a header-tall gap). Reproduced locally:
  Friends → History → Friends turned the header sticky. The phone position is now `!important`.
*/
const topbar = readFileSync("features/app-shell/app-topbar.tsx", "utf8");
const floatsWhateverTheOrder = (src: string) => /glassBar \? "[^"]*\bmax-lg:!fixed\b[^"]*"/.test(src) && !/glassBar \? "[^"]*\bmax-lg:fixed\b/.test(src);

describe("the floating header stays floating whichever stylesheet loads last", () => {
  it("its phone position is !important", () => {
    expect(floatsWhateverTheOrder(topbar)).toBe(true);
  });
  it("teeth: the plain variant (what shipped) fails", () => {
    // the class list itself (the comment above it also names the class)
    expect(floatsWhateverTheOrder(topbar.replace(/(glassBar \? "[^"]*)max-lg:!fixed/, "$1max-lg:fixed"))).toBe(false);
  });
});

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, ".next/app-build-manifest.json");
describe.skipIf(!existsSync(MANIFEST))("the built sheets", () => {
  const pages = () => JSON.parse(readFileSync(MANIFEST, "utf8")).pages as Record<string, string[]>;
  const sheet = (key: string) => (pages()[key] ?? []).filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(ROOT, ".next", f), "utf8")).join("");
  it("the app sheet carries the header's phone rule as !important", () => {
    expect(sheet("/(app)/layout")).toMatch(/\.max-lg\\:\\!fixed\{position:fixed!important\}/);
  });
  it("why it must: the entry sheet has .sticky and no max-lg rules, so it can outrank a plain one", () => {
    const entry = sheet("/(marketing)/layout");
    expect(entry).toMatch(/\.sticky\{position:sticky\}/);
    expect(entry).not.toMatch(/max-lg\\:/);
  });
});
