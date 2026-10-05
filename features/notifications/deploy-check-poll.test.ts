import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The new-deploy check was the ONLY client interval that polled the network,
 * and it ran unconditionally every 60 s — hidden tabs and forgotten installed
 * apps included (~60 /api/app-version invocations an hour per tab). Audited
 * 2026-10-05: every other client `setInterval` is a local UI timer.
 */
const SRC = readFileSync(join(process.cwd(), "features/notifications/register-sw.tsx"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The callback of every setInterval in the file. */
function intervalBodies(code: string): string[] {
  return [...code.matchAll(/setInterval\(\s*(\(\)\s*=>\s*\{[\s\S]*?\}|[\w.]+)\s*,/g)].map((m) => m[1]!);
}

function ungated(bodies: string[]): string[] {
  return bodies.filter((b) => !/document\.visibilityState === "visible"/.test(b));
}

describe("deploy check — never polls while nobody is looking", () => {
  it("has exactly one interval, and it only acts on a VISIBLE tab", () => {
    const bodies = intervalBodies(CODE);
    expect(bodies).toHaveLength(1);
    expect(ungated(bodies)).toEqual([]);
  });

  it("polls no more often than every five minutes", () => {
    const m = /APP_VERSION_POLL_MS = (\d+) \* (\d+) \* (\d+);/.exec(CODE);
    expect(m, "APP_VERSION_POLL_MS changed shape — re-point this test").not.toBeNull();
    expect(Number(m![1]) * Number(m![2]) * Number(m![3])).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(CODE).toMatch(/\}, APP_VERSION_POLL_MS\);/);
  });

  it("TEETH: the old unconditional form is caught", () => {
    expect(ungated(intervalBodies(`const interval = window.setInterval(check, 60_000);`))).toEqual(["check"]);
  });
});
