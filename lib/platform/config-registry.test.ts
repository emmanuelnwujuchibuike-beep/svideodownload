import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getConfigSurfaces } from "./config-registry";

const ROOT = path.resolve(__dirname, "../..");

function sourceProblems(entries: { id: string; source: string; status: string }[]): string[] {
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

describe("Configuration Registry", () => {
  it("every live surface points at a real file; planned name none", () => {
    const problems = sourceProblems(getConfigSurfaces());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("names approval-workflow and geo/device targeting as honestly planned", () => {
    const byId = new Map(getConfigSurfaces().map((s) => [s.id, s]));
    expect(byId.get("approval-workflow")?.status).toBe("planned");
    expect(byId.get("geo-device-targeting")?.status).toBe("planned");
  });
});

describe("Configuration Registry — the source check has teeth", () => {
  it("catches a live surface with a missing file", () => {
    expect(sourceProblems([{ id: "x", source: "lib/nope.ts", status: "live" }]).some((p) => p.includes("does not exist"))).toBe(true);
  });
});
