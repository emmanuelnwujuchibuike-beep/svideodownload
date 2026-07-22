import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPONENT_CATEGORIES,
  type ComponentDef,
  getComponentRegistry,
} from "./component-registry";

const ROOT = path.resolve(__dirname, "../..");
const CATEGORY_IDS = new Set(COMPONENT_CATEGORIES.map((c) => c.id));

/** Source-path problems, honouring the three statuses. */
function sourceProblems(entries: Pick<ComponentDef, "id" | "source" | "status">[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else if (e.status === "live") {
      if (!e.source) problems.push(`"${e.id}" is live but names no source`);
      else if (!existsSync(path.join(ROOT, e.source))) problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
    } else {
      // convention: may be sourceless, but a named source must be real.
      if (e.source && !existsSync(path.join(ROOT, e.source))) problems.push(`"${e.id}" (convention) points at "${e.source}", which does not exist`);
    }
  }
  return problems;
}

describe("Component Registry", () => {
  it("every live component points at a file that exists; planned name none", () => {
    const problems = sourceProblems(getComponentRegistry());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every entry has a known category and a stated a11y + motion contract", () => {
    for (const c of getComponentRegistry()) {
      expect(CATEGORY_IDS.has(c.category), `${c.id} has unknown category "${c.category}"`).toBe(true);
      expect(c.a11y.length, `${c.id} has no a11y contract`).toBeGreaterThan(0);
      expect(c.motion.length, `${c.id} has no motion note`).toBeGreaterThan(0);
    }
  });

  it("documents the archetypes the brief lists as either live or an honest convention/plan", () => {
    const byId = new Map(getComponentRegistry().map((c) => [c.id, c]));
    // Button/input/card are utility patterns here, not wrapper components — say so.
    expect(byId.get("button")?.status).toBe("convention");
    expect(byId.get("input")?.status).toBe("convention");
    expect(byId.get("card")?.status).toBe("convention");
  });
});

describe("Component Registry — the source check has teeth", () => {
  it("catches a live component with a missing file", () => {
    const problems = sourceProblems([{ id: "x", source: "components/nope.tsx", status: "live" }]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned component that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "y", source: "components/x.tsx", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
});
