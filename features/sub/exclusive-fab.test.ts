import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(app)/exclusive/page.tsx", "utf8");
const slot = readFileSync("features/sub/exclusive-fab-slot.tsx", "utf8");
const fab = readFileSync("features/sub/exclusive-create-fab.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

// Owner, 2026-10-31: a glass "+" on the Exclusive feed — set up → compose, not set up → setup; lazy, warm, no perf cost.
function ok(p: string, s: string, f: string, c: string): boolean {
  return (
    // the settings read streams on its own, after the feed
    /<Suspense fallback=\{null\}>\s*<CreateFab viewerId=\{user\.id\} \/>/.test(p) &&
    /mode=\{ready \? "compose" : "setup"\}/.test(p) &&
    /\?tab=sub/.test(p) &&
    // the button's code is never a static import of the page: the slot imports it after load, when idle
    !/^import [^;]*exclusive-create-fab"/m.test(s.replace(/^import type [^;]*;/gm, "")) &&
    /import\("@\/features\/sub\/exclusive-create-fab"\)/.test(s) &&
    /document\.readyState === "complete"/.test(s) &&
    // warm-up: the composer chunk, or the setup page prefetched
    /if \(mode === "compose"\) void loadComposer\(\)/.test(f) &&
    /else router\.prefetch\(setupHref\);/.test(f) &&
    // the reference's glass button and spring press
    /"frenz-orb frenz-nav-glass fixed/.test(f) &&
    /\.frenz-orb:active \{\s*scale: 0\.92;/.test(c) &&
    /\.frenz-orb \{[^}]*cubic-bezier\(0\.28, 1\.4, 0\.46, 1\)/.test(c)
  );
}

describe("the Exclusive feed's floating +", () => {
  it("holds", () => {
    expect(ok(page, slot, fab, css)).toBe(true);
  });
  it("has teeth", () => {
    expect(ok(page, 'import { ExclusiveCreateFab } from "@/features/sub/exclusive-create-fab";\n' + slot, fab, css)).toBe(false);
    expect(ok(page.replace('mode={ready ? "compose" : "setup"}', 'mode="setup"'), slot, fab, css)).toBe(false);
    expect(ok(page, slot, fab.replace("else router.prefetch(setupHref);", ""), css)).toBe(false);
    expect(ok(page, slot, fab, css.replace("scale: 0.92;", "scale: 1;"))).toBe(false);
  });
});
