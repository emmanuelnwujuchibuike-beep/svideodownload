import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/**
 * 🔴 THE LANDING'S OWN SHEET (owner, 2026-10-31: "the landing and Download page still doesn't open fast … should be
 * below 1.6"). Measured on production that day: `/` and the downloader pages painted at 2.4–2.7 s on fast 4G, and before
 * the paint the main thread was mostly idle — waiting on the 333 kB entry sheet — then busy styling the page against it
 * (UpdateLayoutTree up to 600 ms). The entry sheet had grown to the whole app's size because the marketing tree reaches
 * almost every feature through lazy imports. Compiled against what the landing and downloader pages import STATICALLY
 * (what can be on screen at first paint) it is ~173 kB, about half. Their lazy parts — sheets, dialogs, a result card —
 * are styled by the entry sheet, loaded right after the first paint (features/perf/later-styles.tsx).
 */
export const LANDING_CSS_ROOTS = [
  "app/layout.tsx",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/(marketing)/layout.tsx",
  "app/(marketing)/template.tsx",
  "app/(marketing)/page.tsx",
  "app/(marketing)/[downloader]",
  // the landing's below-the-fold sections arrive from this handler after the paint; +1 kB, so no unstyled flash
  "app/landing-sections",
];

const SOURCE = /\.(tsx?|jsx?|mjs)$/;
/** Static imports and re-exports only — no `import()` / next/dynamic: what can be on screen at first paint. */
const STATIC_IMPORT = /(?:^|[^.\w$])(?:import|export)\s+(?!type\b)(?:[^'";]*?from\s*)?["']([^"']+)["']/gm;
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
export function reachableFiles(rootDir: string, roots: readonly string[] = ENTRY_CSS_ROOTS, opts: { staticOnly?: boolean } = {}): string[] {
  const pattern = opts.staticOnly ? STATIC_IMPORT : IMPORT;
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
    for (const m of src.matchAll(pattern)) {
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

/**
 * Where the landing's Tailwind input lives (git-ignored). 2026-10-28: the config used to hand Tailwind the reachable
 * files as RAW TEXT, which it does not record as build inputs — so Vercel's restored build cache served a sheet compiled
 * for an older tree (the React landing shipped without its own classes). A real file IS recorded: when anything the
 * landing reaches changes, this file changes, and the cached sheet is thrown away.
 */
export const ENTRY_CONTENT_FILE = ".cache/entry-css-content.txt";

/**
 * Write every file the landing tree can reach into ENTRY_CONTENT_FILE (only when it changed, so an unchanged tree keeps
 * its cache). Called at the start of every build (next.config.ts) and by the Tailwind config. Returns the absolute path.
 */
export function writeEntryContent(rootDir: string): string {
  return writeContent(rootDir, ENTRY_CONTENT_FILE, reachableFiles(rootDir));
}

/** The landing sheet's Tailwind input (git-ignored), the same way: what LANDING_CSS_ROOTS reach statically. */
export const LANDING_CONTENT_FILE = ".cache/landing-css-content.txt";

export function writeLandingContent(rootDir: string): string {
  return writeContent(rootDir, LANDING_CONTENT_FILE, reachableFiles(rootDir, LANDING_CSS_ROOTS, { staticOnly: true }));
}

function writeContent(rootDir: string, file: string, files: readonly string[]): string {
  const out = path.join(rootDir, file);
  const body = files
    .map((f) => `/* @@file ${path.relative(rootDir, f).replace(/\\/g, "/")} */\n${readFileSync(f, "utf8")}`)
    .join("\n");
  let current: string | null = null;
  try {
    current = readFileSync(out, "utf8");
  } catch {
    current = null;
  }
  if (current !== body) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, body);
  }
  return out;
}
