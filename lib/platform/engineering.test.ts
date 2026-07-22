import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENGINEERING_ASSET_KINDS,
  type EngineeringAsset,
  getEngineeringAssets,
} from "./engineering-registry";
import { getEngineeringStandards, STANDARD_AREAS } from "./engineering-standards";

const ROOT = path.resolve(__dirname, "../..");
const KIND_IDS = new Set(ENGINEERING_ASSET_KINDS.map((k) => k.id));
const AREA_IDS = new Set(STANDARD_AREAS.map((a) => a.id));

function sourceProblems(entries: Pick<EngineeringAsset, "id" | "source" | "status">[]): string[] {
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

describe("Engineering Registry", () => {
  it("every live asset points at a file that exists; planned name none", () => {
    const problems = sourceProblems(getEngineeringAssets());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every asset has a known kind", () => {
    for (const a of getEngineeringAssets()) {
      expect(KIND_IDS.has(a.kind), `${a.id} has unknown kind "${a.kind}"`).toBe(true);
    }
  });

  it("the scaffold generator and doc analytics are honestly planned", () => {
    const byId = new Map(getEngineeringAssets().map((a) => [a.id, a]));
    expect(byId.get("scaffold-generator")?.status).toBe("planned");
    expect(byId.get("doc-usage-analytics")?.status).toBe("planned");
  });
});

describe("Engineering Standards", () => {
  it("are non-empty, in known areas, and every named reference exists", () => {
    const standards = getEngineeringStandards();
    expect(standards.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const s of standards) {
      if (!AREA_IDS.has(s.area)) problems.push(`${s.id}: unknown area "${s.area}"`);
      if (!s.howEnforced) problems.push(`${s.id}: no enforcement stated`);
      if (s.reference && !existsSync(path.join(ROOT, s.reference))) {
        problems.push(`${s.id}: reference "${s.reference}" does not exist`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Engineering catalogue — the source check has teeth", () => {
  it("catches a live asset with a missing file", () => {
    expect(sourceProblems([{ id: "x", source: "docs/nope.md", status: "live" }]).some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned asset that pretends to have a source", () => {
    expect(sourceProblems([{ id: "y", source: "docs/x.md", status: "planned" }]).some((p) => p.includes("planned but names a source"))).toBe(true);
  });
});
