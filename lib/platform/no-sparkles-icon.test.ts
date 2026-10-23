import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 🔴 OWNER RULE (since June 2026, restated 2026-10-17 with a screenshot): the sparkle — lucide's
 * four-point star with a small plus, the generic "AI" icon — is NEVER used anywhere in the app,
 * no matter what. Not Sparkles, not Sparkle, not WandSparkles, not by name in an icon registry,
 * not as a custom glyph. Pick another icon. The ✨ EMOJI a person sends as a sticker is content,
 * not an app icon, and is not covered.
 */

const ROOTS = ["app", "features", "components", "lib", "config"];
const THIS = join("lib", "platform", "no-sparkles-icon.test.ts");

function sources(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !p.endsWith(THIS)) out.push(p);
  }
  return out;
}

/** every way the sparkle icon gets into the UI */
export function sparkleUses(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const spec of m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!)) if (/^(Sparkles?|WandSparkles|Wand2|Sparkles?Icon|LucideSparkles?)$/.test(spec)) hits.push(`import ${spec}`);
  }
  if (/\b(Icons|Lucide|lucide)\.(Sparkles?|WandSparkles|Wand2)\b/.test(src)) hits.push("namespace member");
  if (/\bicon\??\s*:\s*["'](Sparkles?|WandSparkles|Wand2)["']/.test(src)) hits.push("icon name string");
  if (/lucide-react\/dist\/esm\/icons\/(sparkles?|wand-sparkles|wand-2)/.test(src)) hits.push("deep import");
  if (/\bFrenzSparkle(Outline|Solid)?\b/.test(src)) hits.push("custom sparkle glyph");
  return hits;
}

describe("🔴 the sparkle ('AI star') icon is used nowhere (owner rule)", () => {
  const files = ROOTS.flatMap((r) => sources(join(process.cwd(), r)));

  it("scans the real source tree", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no file imports, names or draws it", () => {
    const offenders = files.map((f) => ({ f: f.slice(process.cwd().length + 1), hits: sparkleUses(readFileSync(f, "utf8")) })).filter((x) => x.hits.length);
    expect(offenders).toEqual([]);
    // reads every source file — measured past the 5 s default on the synced (OneDrive) checkout
  }, 30_000);

  it("teeth: each way back in is caught", () => {
    expect(sparkleUses(`import { Bell, Sparkles } from "lucide-react";`)).toEqual(["import Sparkles"]);
    expect(sparkleUses(`import {\n  WandSparkles,\n} from "lucide-react";`)).toEqual(["import WandSparkles"]);
    expect(sparkleUses(`import { Sparkle as Star2 } from "lucide-react";`)).toEqual(["import Sparkle"]);
    expect(sparkleUses(`const I = Icons.Sparkles;`)).toEqual(["namespace member"]);
    expect(sparkleUses(`{ id: "ai", icon: "Sparkles" }`)).toEqual(["icon name string"]);
    expect(sparkleUses(`<FrenzSparkleSolid />`)).toEqual(["custom sparkle glyph"]);
    // 2026-10-18 (owner): Wand2 draws little stars round the wand — the sparkle by another name
    expect(sparkleUses(`import { Wand2 } from "lucide-react";`)).toEqual(["import Wand2"]);
    expect(sparkleUses(`{ id: "ai", icon: "Wand2" }`)).toEqual(["icon name string"]);
    // … and what is NOT the icon passes: prose, the emoji sticker, its label
    expect(sparkleUses(`description: "Sparkle and shine", { glyph: "✨", label: "Sparkles" }`)).toEqual([]);
  });
});
