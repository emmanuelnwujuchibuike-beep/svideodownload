import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { allCatalogedTables, DATA_DOMAINS, type StorageKind } from "./data-domains";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const STORAGE_KINDS: StorageKind[] = ["relational", "object", "cache", "search", "event-log"];

/** Every table actually created in a migration. */
function migrationTables(): Set<string> {
  const tables = new Set<string>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) tables.add(m[1]!);
  }
  return tables;
}

const REAL = migrationTables();

describe("Data Domain Registry — integrity", () => {
  it("domain ids are unique and storage kinds are valid", () => {
    const seen = new Set<string>();
    for (const d of DATA_DOMAINS) {
      expect(seen.has(d.id), `duplicate domain id: "${d.id}"`).toBe(false);
      seen.add(d.id);
      for (const s of d.storage) expect(STORAGE_KINDS).toContain(s);
    }
  });

  it("finds a non-trivial number of real tables (guards the parser)", () => {
    expect(REAL.size).toBeGreaterThan(50);
  });
});

describe("Data Domain Registry — catalogue matches the real schema", () => {
  it("every catalogued table is owned by exactly one domain", () => {
    const seen = new Map<string, string>();
    const doubles: string[] = [];
    for (const d of DATA_DOMAINS) {
      for (const t of d.tables) {
        if (seen.has(t)) doubles.push(`${t} (in ${seen.get(t)} and ${d.id})`);
        seen.set(t, d.id);
      }
    }
    expect(doubles, `tables owned by more than one domain:\n  ${doubles.join("\n  ")}`).toEqual([]);
  });

  it("every catalogued table exists in a migration", () => {
    const missing = allCatalogedTables().filter((t) => !REAL.has(t));
    expect(missing, `catalogued tables that no migration creates:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("every real table is catalogued (no domain-less orphans)", () => {
    const cataloged = new Set(allCatalogedTables());
    const orphans = [...REAL].filter((t) => !cataloged.has(t)).sort();
    expect(
      orphans,
      `real tables with no owning domain — add each to lib/platform/data-domains.ts:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("Data Domain Registry — the check has teeth", () => {
  it("would catch a catalogued table that no migration creates", () => {
    expect(REAL.has("table_that_does_not_exist")).toBe(false);
  });
});
