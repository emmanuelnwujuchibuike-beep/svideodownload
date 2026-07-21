import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EVENTS, getEvents } from "./events-registry";
import { getRegistries, type RegistryStatus } from "./registries";
import { getServices, type ServiceStatus } from "./services";

/**
 * Keeps the platform catalogues honest (docs/CONSTITUTION.md, Article I.3): a
 * `live`/`partial` entry must point at a real file, and a `planned` entry must not
 * pretend to. Without this, the Registry-of-Registries and the Service Registry
 * could quietly describe files that don't exist — the "products that were never
 * built" failure, one level up.
 */

const ROOT = path.resolve(__dirname, "../..");
const SNAKE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Pure detector: source-path problems for a set of catalogue entries. */
function sourceProblems(
  entries: { id: string; source: string; status: RegistryStatus | ServiceStatus }[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else {
      if (!e.source) problems.push(`"${e.id}" is ${e.status} but names no source`);
      else if (!existsSync(path.join(ROOT, e.source))) {
        problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
      }
    }
  }
  return problems;
}

describe("Event Registry", () => {
  it("has unique, snake_case ids and is non-empty", () => {
    expect(EVENTS.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const e of getEvents()) {
      expect(SNAKE.test(e.id), `event id not snake_case: "${e.id}"`).toBe(true);
      expect(seen.has(e.id), `duplicate event id: "${e.id}"`).toBe(false);
      seen.add(e.id);
    }
  });
});

describe("Registry of Registries", () => {
  it("every live/partial registry points at a file that exists", () => {
    const problems = sourceProblems(getRegistries());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Service Registry", () => {
  it("every live/partial service points at a file that exists", () => {
    const problems = sourceProblems(getServices());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live entry pointing at a missing file", () => {
    const problems = sourceProblems([
      { id: "ghost", source: "lib/platform/does-not-exist.ts", status: "live" },
    ]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned entry that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "fake", source: "lib/x.ts", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
  it("catches a live entry with no source", () => {
    const problems = sourceProblems([{ id: "empty", source: "", status: "live" }]);
    expect(problems.some((p) => p.includes("names no source"))).toBe(true);
  });
});
