/**
 * Repository snapshot — the reference truth the Sync Engine detects drift against.
 *
 * Reads routes, migrations and mount sites off disk. Isolated in its own module so
 * `detect.ts` stays pure and testable: every detector takes a snapshot as data, and
 * a test can hand it a synthetic one rather than needing a filesystem.
 *
 * Node-only (`node:fs`). Never import this from a component — it is for the CLI,
 * tests, and the admin route handler.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { RepoSnapshot } from "./detect";
import { scanMigrations, scanRoutes } from "./scan";

/** Files whose mount state affects whether a product is reachable. */
const MOUNT_SITES = ["app/layout.tsx", "app/(app)/layout.tsx", "app/(marketing)/page.tsx"];

/*
 * `scanRoutes` / `scanMigrations` live in ./scan, which imports nothing but
 * node built-ins so `next.config.ts` can call them at build time without
 * dragging this module's graph into config evaluation. Re-exported so every
 * existing importer is unchanged.
 */
export { scanMigrations, scanRoutes };

export function readMountSites(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of MOUNT_SITES) {
    try {
      files[rel] = readFileSync(path.join(root, rel), "utf8");
    } catch {
      /* not every project has every mount site */
    }
  }
  return files;
}

/**
 * True when the repository could not be read from this environment.
 *
 * 🔴 AN EMPTY SNAPSHOT IS "I CANNOT SEE", NOT "NOTHING EXISTS".
 *
 * Every route-existence detector is written as `!exists(route)`, so a snapshot
 * with zero routes makes every single module look like a dead 404. That is
 * exactly what shipped: on Vercel the source `app/` directory is not in the
 * serverless bundle, `readdirSync` threw, the catch returned `[]`, and
 * /admin/content reported 23 "factual-break" findings and refused to publish —
 * while the site it was describing was entirely fine.
 *
 * The build-time inventory in next.config.ts is the actual fix. This is the guard
 * that stops the same failure from ever again presenting itself as 23
 * confident, specific, wrong statements: an app cannot have zero routes, so
 * zero routes can only mean the scan failed.
 */
export function isSnapshotBlind(snapshot: RepoSnapshot): boolean {
  return snapshot.routes.length === 0;
}

/**
 * An inventory taken at BUILD time, when the source tree definitely exists.
 *
 * 🔴 `readdirSync` ON `app/` DOES NOT WORK IN A SERVERLESS BUNDLE. Only traced
 * files ship, source `app/` is not among them, and the throw/catch returned an
 * empty list — which every `!exists(route)` detector then read as "every route
 * on the site is missing". next.config.ts inlines these two lists instead, so
 * the answer no longer depends on what survived tracing.
 *
 * Names only, never file contents. Falls back to the disk scan for the CLI,
 * the tests and `next dev`, where the repository is right there.
 */
/*
  🔴 LITERAL `process.env.NAME`, NEVER `process.env[key]`.

  Next inlines `env` values with DefinePlugin, which performs a TEXTUAL
  substitution on literal member access. A computed lookup is invisible to it,
  so the first version of this read `process.env[key]`, nothing was substituted,
  and the build-time inventory silently never reached the bundle — the exact
  failure it exists to fix, one layer down. Read as literals here, then look up.
*/
const BUILD_INVENTORY: Record<string, string | undefined> = {
  FRENZ_REPO_ROUTES: process.env.FRENZ_REPO_ROUTES,
  FRENZ_REPO_MIGRATIONS: process.env.FRENZ_REPO_MIGRATIONS,
};

function fromBuild(key: "FRENZ_REPO_ROUTES" | "FRENZ_REPO_MIGRATIONS"): string[] | null {
  const raw = BUILD_INVENTORY[key];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // An empty array is indistinguishable from a failed scan at build time, so
    // treat it as absent and let the disk scan have its say.
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function takeSnapshot(root: string, now = new Date()): RepoSnapshot {
  return {
    routes: fromBuild("FRENZ_REPO_ROUTES") ?? scanRoutes(root),
    migrations: fromBuild("FRENZ_REPO_MIGRATIONS") ?? scanMigrations(root),
    files: readMountSites(root),
    now,
  };
}
