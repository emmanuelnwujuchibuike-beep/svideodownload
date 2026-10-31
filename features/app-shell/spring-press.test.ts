import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const springs = readFileSync("lib/motion/springs.ts", "utf8");

// Owner, 2026-10-31: "other global press is still on bounce instead of the spring press like the bottom NAV".
function springEverywhere(c: string, s: string): boolean {
  return (
    /--ease-spring: cubic-bezier\(0\.28, 1\.4, 0\.46, 1\);/.test(c) &&
    /--dur-press: 250ms;/.test(c) &&
    // every Tailwind active:scale press takes the curve
    /\[class\*="active:scale-"\]\[class\*="active:scale-"\] \{\s*transition-timing-function: var\(--ease-spring\);\s*transition-duration: var\(--dur-press\);/.test(c) &&
    // no press transform left on the old overshoot curve
    !/transform [^;,]*cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/.test(c) &&
    // framer presses use the same curve
    /press: \{ type: "tween", duration: 0\.25, ease: \[0\.28, 1\.4, 0\.46, 1\] \}/.test(s)
  );
}

describe("one spring press everywhere", () => {
  it("holds", () => {
    expect(springEverywhere(css, springs)).toBe(true);
  });
  it("has teeth", () => {
    expect(springEverywhere(css.replace("--ease-spring: cubic-bezier(0.28, 1.4, 0.46, 1);", "--ease-spring: cubic-bezier(0.34, 1.4, 0.5, 1);"), springs)).toBe(false);
    expect(springEverywhere(css + "\n.x { transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }", springs)).toBe(false);
    expect(springEverywhere(css, springs.replace("ease: [0.28, 1.4, 0.46, 1]", "ease: [0.4, 0, 0.2, 1]"))).toBe(false);
  });
});
