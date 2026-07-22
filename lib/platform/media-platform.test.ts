import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDeliveryCapabilities,
  getMediaAi,
  getMediaObservability,
  getMediaServices,
  getPipelineStages,
  getStorageTiers,
  getSupportedMedia,
  type MediaStatus,
} from "./media-platform";

/**
 * Keeps the Media Registry honest (docs/CONSTITUTION.md, Article I.3): a
 * `live`/`partial` row must point at a file that exists, and a `planned` row must
 * not pretend to. Without this the catalogue could quietly describe media
 * infrastructure that isn't there — the "products that were never built" failure,
 * one level up.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Pure detector: source-path problems for a set of catalogue rows. */
function sourceProblems(entries: { id: string; source: string; status: MediaStatus }[]): string[] {
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

const CATALOGUES: Record<string, { id: string; source: string; status: MediaStatus }[]> = {
  services: getMediaServices(),
  "storage tiers": getStorageTiers(),
  "pipeline stages": getPipelineStages(),
  delivery: getDeliveryCapabilities(),
  "media AI": getMediaAi(),
  observability: getMediaObservability(),
};

describe("Media Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("every supported media kind is handled by a declared service (or planned with none)", () => {
    const serviceIds = new Set(getMediaServices().map((s) => s.id));
    const seen = new Set<string>();
    for (const m of getSupportedMedia()) {
      expect(seen.has(m.id), `duplicate supported-media id "${m.id}"`).toBe(false);
      seen.add(m.id);
      if (m.status === "planned") {
        expect(m.handledBy, `${m.id} is planned but names a handler`).toBe("");
      } else {
        expect(serviceIds.has(m.handledBy), `${m.id} → unknown service "${m.handledBy}"`).toBe(true);
      }
    }
  });

  it("streaming, upload and immutable caching are live — the load-bearing path", () => {
    const byId = new Map(getMediaServices().map((s) => [s.id, s.status]));
    expect(byId.get("stream")).toBe("live");
    expect(byId.get("upload")).toBe("live");
    expect(byId.get("object-store")).toBe("live");
  });

  it("the AI enhancement/detection stack is honestly planned, captions are live", () => {
    const byId = new Map(getMediaAi().map((c) => [c.id, c.status]));
    expect(byId.get("captions")).toBe("live");
    for (const future of ["bg-removal", "upscaling", "object-detection", "smart-crop", "tts", "ai-generation"]) {
      expect(byId.get(future), `${future} should be planned`).toBe("planned");
    }
  });

  it("cold archival and content-hash dedupe are not claimed as shipped", () => {
    const byId = new Map(getStorageTiers().map((t) => [t.id, t.status]));
    expect(byId.get("cold-archival")).toBe("planned");
    expect(byId.get("content-dedupe")).toBe("planned");
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/media/does-not-exist.ts", status: "live" }]);
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
