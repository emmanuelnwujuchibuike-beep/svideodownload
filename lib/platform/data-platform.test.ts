import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getKnowledgeFabric,
  getLifecyclePolicies,
  getStorageStrategies,
} from "./data-platform";

const ROOT = path.resolve(__dirname, "../..");

function migrationTables(): Set<string> {
  const tables = new Set<string>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
  const dir = path.join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) tables.add(m[1]!);
  }
  return tables;
}

/** live/partial ⇒ source exists on disk; planned ⇒ no source. */
function sourceProblems(entries: { id: string; source: string; status: string }[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
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

describe("Data Platform — storage strategies", () => {
  it("every live strategy points at a real access point; planned name none", () => {
    const problems = sourceProblems(getStorageStrategies());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("names a vector index and a warehouse, both honestly planned", () => {
    const byId = new Map(getStorageStrategies().map((s) => [s.id, s]));
    expect(byId.get("vector")?.status).toBe("planned");
    expect(byId.get("warehouse")?.status).toBe("planned");
  });
});

describe("Data Platform — lifecycle policies", () => {
  it("every live policy's mechanism exists on disk; planned name none", () => {
    const problems = sourceProblems(
      getLifecyclePolicies().map((p) => ({ id: p.id, source: p.mechanism, status: p.status })),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Data Platform — Knowledge Fabric", () => {
  it("every relationship is materialised by a real table", () => {
    const real = migrationTables();
    const bad = getKnowledgeFabric().filter((r) => !real.has(r.via));
    expect(
      bad.map((r) => `${r.from}->${r.to} via ${r.via}`),
      "relationships whose `via` table does not exist",
    ).toEqual([]);
  });
});

describe("Data Platform — the checks have teeth", () => {
  it("catches a live entry with a missing source and a planned entry with one", () => {
    expect(sourceProblems([{ id: "a", source: "lib/nope.ts", status: "live" }]).some((p) => p.includes("does not exist"))).toBe(true);
    expect(sourceProblems([{ id: "b", source: "lib/x.ts", status: "planned" }]).some((p) => p.includes("planned but names a source"))).toBe(true);
  });
});
