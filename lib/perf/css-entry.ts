import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The files whose Tailwind classes go into the COLD-ENTRY stylesheet (`app/entry.css`), computed at build time.
 *
 * 2026-10-27, owner: "the landing page … and the Download page now loads like am downloading a file … that's my key
 * features, I don't joke with". Measured: every page — the landing included — waited on ONE 455 kB (67 kB gzipped)
 * stylesheet before painting anything, because `app/globals.css` was compiled against the WHOLE app (chat, studio,
 * wallet, admin…). Compiled against only what the marketing tree can reach it is ~37–50 kB gzipped.
 *
 * So `tailwind.entry.config.ts` uses this list as its `content`: every project file reachable — by static import,
 * re-export or a literal `import("…")` (next/dynamic included) — from the root layout, the root boundaries, the
 * marketing route group and the landing-sections handler. It is a walk, not a hand-kept list, so a new component on
 * the landing is picked up by the next build without anyone remembering to add it.
 *
 * The output is the same `globals.css` with fewer utilities; every rule in it is also in the full sheet, in the
 * same order. What it cannot see: a class name built from a template string at runtime — the same limit Tailwind's
 * own content scan has everywhere.
 */
export const ENTRY_CSS_ROOTS = [
  "app/layout.tsx",
  "app/error.tsx",
  "app/not-found.tsx",
  "app/global-error.tsx",
  "app/(marketing)",
  "app/landing-sections",
];

const SOURCE = /\.(tsx?|jsx?|mjs)$/;
const IMPORT = /(?:^|[^.\w$])(?:import|export)\s+(?!type\b)(?:[^'";]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;

function resolveFile(p: string): string | null {
  for (const ext of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"]) {
    const f = p + ext;
    if (SOURCE.test(f) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

function listDir(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) listDir(p, out);
    else if (SOURCE.test(name) && !/\.test\./.test(name)) out.push(p);
  }
}

/** Absolute paths of every file reachable from `roots` (relative to `rootDir`). Exported for the guard test. */
export function reachableFiles(rootDir: string, roots: readonly string[] = ENTRY_CSS_ROOTS): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    const abs = path.join(rootDir, r);
    if (!existsSync(abs)) continue;
    const start: string[] = [];
    if (statSync(abs).isDirectory()) listDir(abs, start);
    else start.push(abs);
    for (const f of start) {
      if (seen.has(f)) continue;
      seen.add(f);
      queue.push(f);
    }
  }
  while (queue.length) {
    const file = queue.shift()!;
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? "";
      const target = spec.startsWith("@/") ? path.join(rootDir, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
      const hit = target && resolveFile(target);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        queue.push(hit);
      }
    }
  }
  return [...seen].sort();
}
