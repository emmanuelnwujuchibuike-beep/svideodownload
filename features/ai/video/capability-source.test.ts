import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 §25 — CAPABILITIES ARE COMPILED IN, NEVER FETCHED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Audited 2026-10-05: the AI video screens make ZERO capability requests. The
 * limits a member sees (prompt length, durations, reference counts) come from
 * `lib/ai/kling/features/capabilities.ts` — a constants module with no imports
 * — and the server's request schema (`lib/ai/video/schemas.ts`) validates
 * against the SAME object. So the UI and the backend cannot disagree inside
 * one deploy, and the cost of "staying synchronised" is nothing at all.
 *
 * The regressions this guards are the two ways that property is lost:
 *   1. a client file starts fetching capabilities (a request per page view
 *      for data that only changes on deploy — §25's "repeatedly fetch
 *      identical capability information"), or
 *   2. the UI or the schema hand-copies a limit instead of importing it, and
 *      the two drift.
 */

const CAPS_IMPORT = /from "@\/lib\/ai\/kling\/features\/capabilities"/;

function clientFiles(): string[] {
  const dir = join(process.cwd(), "features", "ai");
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.includes(".test."))
    .map((f) => join(dir, f));
}

/** A request whose URL mentions capabilities, anywhere in client AI code. */
function capabilityFetches(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/(?:fetch|useSWR|useQuery)\s*\(\s*[`'"][^`'"]*capabilit[^`'"]*[`'"]/gi)].map((m) => m[0]);
}

describe("Part 7 §25 — capability caching", () => {
  it("no AI client code fetches capabilities", () => {
    const files = clientFiles();
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap((f) => capabilityFetches(readFileSync(f, "utf8")).map((h) => `${f}: ${h}`));
    expect(hits).toEqual([]);
  });

  it("the server schema and every video workspace read the SAME capability module", () => {
    const root = process.cwd();
    for (const rel of [
      "lib/ai/video/schemas.ts",
      "features/ai/video/text-to-video-workspace.tsx",
      "features/ai/video/image-to-video-workspace.tsx",
      "features/ai/video/ai-reference-rail.tsx",
    ]) {
      expect(readFileSync(join(root, rel), "utf8"), rel).toMatch(CAPS_IMPORT);
    }
  });

  it("the capability module imports nothing — it is safe and cheap to ship to the client", () => {
    const src = readFileSync(join(process.cwd(), "lib/ai/kling/features/capabilities.ts"), "utf8");
    expect(src).not.toMatch(/^import\s/m);
  });

  it("TEETH: a capability fetch is caught; a comment about one is not", () => {
    expect(capabilityFetches(`const r = await fetch("/api/ai/video/capabilities");`)).toHaveLength(1);
    expect(capabilityFetches("useSWR(`/api/ai/capabilities?f=t2v`, get)")).toHaveLength(1);
    expect(capabilityFetches(`// we used to fetch("/api/ai/capabilities") here`)).toHaveLength(0);
    expect(capabilityFetches(`await fetch("/api/ai/video/quote")`)).toHaveLength(0);
  });
});
