import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A CLIENT COMPONENT MUST NOT VALUE-IMPORT A SERVER-SHAPED MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * lib/landing/settings.ts imports the service-role Supabase client and builds
 * its defaults from the Character Replace normaliser at module load. Nothing
 * stops a "use client" file importing one small constant from it — TypeScript
 * is happy, `next build` is happy — but the bundler cannot tree-shake a module
 * whose top level runs code, so the one constant brings the whole Character
 * Replace configuration into the eager /admin chunk. That is how /admin went
 * 3 kB over its route budget on 2026-09-14 (see the 368 kB note in
 * lib/perf/budget.test.ts), and the browser-safe pieces now live in
 * lib/landing/bounds.ts.
 *
 * This test is the door held shut: a client file may `import type` from
 * settings.ts (types cost nothing), never a value.
 */
const ROOTS = ["features", "components", "app"];
const SERVER_SHAPED = ["@/lib/landing/settings"];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("client bundles and lib/landing/settings.ts", () => {
  it("no client component value-imports the settings module — bounds.ts is the browser-safe door", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(process.cwd(), root), [])) {
        const src = readFileSync(file, "utf8");
        if (!/^\s*["']use client["']/m.test(src.slice(0, 400))) continue;
        for (const mod of SERVER_SHAPED) {
          const re = new RegExp(`^import\\s+(?!type\\s)[^;]*?from\\s+["']${mod.replace(/[/@.]/g, "\\$&")}["']`, "m");
          if (re.test(src)) offenders.push(`${file.replace(process.cwd(), "").replace(/\\/g, "/")} → ${mod}`);
        }
      }
    }
    expect(offenders, "value imports of a server-shaped module from client files — import from lib/landing/bounds.ts instead").toEqual([]);
  }, 30_000); // a walk over three trees, slow only when a build shares the disk

  it("bounds.ts stays pure — no imports besides the money units", () => {
    const src = readFileSync(join(process.cwd(), "lib/landing/bounds.ts"), "utf8");
    const imports = src.match(/^import\s.*$/gm) ?? [];
    expect(imports).toEqual([]);
    const reexports = src.match(/^export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?$/gm) ?? [];
    expect(reexports.map((r) => r.match(/from\s*["']([^"']+)["']/)?.[1])).toEqual(["@/lib/money/units"]);
  });
});
