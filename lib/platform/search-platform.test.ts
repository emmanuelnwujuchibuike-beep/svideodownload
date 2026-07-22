import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDiscoverySurfaces,
  getRankingSignals,
  getSearchableEntities,
  getSearchCapabilities,
  getSearchIndexes,
  getSeoAssets,
  SEO_ASSET_KINDS,
  type PlatformStatus,
} from "./search-platform";

/**
 * Keeps the Search & Discovery Registry honest (docs/CONSTITUTION.md, Article
 * I.3): a `live`/`partial` row must point at a file that exists, and a `planned`
 * row must not pretend to. Without this the catalogue could quietly describe
 * search infrastructure that isn't there — the "products that were never built"
 * failure, one level up.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Pure detector: source-path problems for a set of catalogue rows. */
function sourceProblems(entries: { id: string; source: string; status: PlatformStatus }[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else if (!e.source) {
      problems.push(`"${e.id}" is ${e.status} but names no source`);
    } else if (!existsSync(path.join(ROOT, e.source))) {
      problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
    }
  }
  return problems;
}

const CATALOGUES: Record<string, { id: string; source: string; status: PlatformStatus }[]> = {
  "searchable entities": getSearchableEntities(),
  indexes: getSearchIndexes(),
  "ranking signals": getRankingSignals(),
  "SEO assets": getSeoAssets(),
  "discovery surfaces": getDiscoverySurfaces(),
  capabilities: getSearchCapabilities(),
};

describe("Search & Discovery Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("every searchable entity is served by a declared index", () => {
    const indexIds = new Set(getSearchIndexes().map((i) => i.id));
    for (const e of getSearchableEntities()) {
      expect(indexIds.has(e.indexId), `${e.id} → unknown index "${e.indexId}"`).toBe(true);
    }
  });

  it("every SEO asset has a known kind", () => {
    const kinds = new Set(SEO_ASSET_KINDS.map((k) => k.id));
    for (const a of getSeoAssets()) {
      expect(kinds.has(a.kind), `${a.id} has unknown kind "${a.kind}"`).toBe(true);
    }
  });

  it("keyword and full-text search are live; the future modes are honestly planned", () => {
    const byId = new Map(getSearchCapabilities().map((c) => [c.id, c.status]));
    expect(byId.get("keyword")).toBe("live");
    expect(byId.get("full-text")).toBe("live");
    // These must never be quietly claimed as shipped.
    for (const future of ["semantic", "voice", "image", "video", "audio", "ocr"]) {
      expect(byId.get(future), `${future} should be planned`).toBe("planned");
    }
  });

  it("an indexable entity that is permission-aware still respects both flags", () => {
    // People are both crawlable (public profiles) and permission-filtered
    // (hidden accounts) — the two are independent, not mutually exclusive.
    const people = getSearchableEntities().find((e) => e.id === "people")!;
    expect(people.indexable).toBe(true);
    expect(people.permissionAware).toBe(true);
    // Messages are the opposite corner: permission-aware and never indexable.
    const messages = getSearchableEntities().find((e) => e.id === "messages")!;
    expect(messages.indexable).toBe(false);
    expect(messages.permissionAware).toBe(true);
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/platform/does-not-exist.ts", status: "live" }]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned row that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "fake", source: "lib/x.ts", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
  it("catches a live row with no source", () => {
    const problems = sourceProblems([{ id: "empty", source: "", status: "live" }]);
    expect(problems.some((p) => p.includes("names no source"))).toBe(true);
  });
});
