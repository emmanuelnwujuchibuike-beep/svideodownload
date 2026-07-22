#!/usr/bin/env node
/**
 * Design Intelligence — prints real component-adoption counts.
 *
 *   node scripts/design-adoption.mjs
 *
 * Honest by construction: it walks the source tree and counts, for each entry in
 * the Component Registry, how many distinct files import it (see
 * lib/platform/design-adoption.ts for the pure counting logic). No number is
 * invented — a component nobody imports reads 0. Node ≥ 23 runs the imported .ts
 * directly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getComponentRegistry } from "../lib/platform/component-registry.ts";
import { computeAdoption } from "../lib/platform/design-adoption.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "features", "lib"];
const EXT = /\.(tsx|ts|jsx|js)$/;

/** Recursively collect { path (repo-relative), content } for source files. */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (EXT.test(name)) {
      out.push({ path: path.relative(ROOT, full).split(path.sep).join("/"), content: readFileSync(full, "utf8") });
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => collect(path.join(ROOT, d), []));
const entries = getComponentRegistry().map((c) => ({ id: c.id, name: c.name, source: c.source }));
const results = computeAdoption(entries, files);

console.log(`Design Intelligence — component adoption across ${files.length} source files\n`);
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const bar = r.specifier === null ? "—  (convention / planned)" : `${String(r.importedBy).padStart(3)} file(s)`;
  console.log(`  ${r.name.padEnd(width)}  ${bar}`);
}

const countable = results.filter((r) => r.specifier !== null);
const unused = countable.filter((r) => r.importedBy === 0);
console.log(`\n  ${countable.length} countable components · ${unused.length} with zero imports${unused.length ? `: ${unused.map((u) => u.id).join(", ")}` : ""}`);
