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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { RepoSnapshot } from "./detect";

/** Files whose mount state affects whether a product is reachable. */
const MOUNT_SITES = ["app/layout.tsx", "app/(app)/layout.tsx", "app/(marketing)/page.tsx"];

/** Route-group segments contribute no URL path. */
const isGroup = (segment: string) => segment.startsWith("(") && segment.endsWith(")");
/** Private folders (`_lib`) and parallel/intercept routes never serve a URL. */
const isNonRoute = (segment: string) => segment.startsWith("_") || segment.startsWith("@");

/**
 * Every route the app serves, derived from the App Router's file conventions.
 *
 * A directory is a route only if it contains `page.tsx` or `route.ts` — a folder of
 * shared components under `app/` is not a URL, and counting it would make the
 * missing-route detector silently pass on a deleted page.
 */
export function scanRoutes(root: string): string[] {
  const appDir = path.join(root, "app");
  const routes: string[] = [];

  const walk = (dir: string, urlPath: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const servesUrl = entries.some((e) => /^(page|route)\.(tsx?|jsx?)$/.test(e));
    if (servesUrl) routes.push(urlPath === "" ? "/" : urlPath);

    for (const entry of entries) {
      const full = path.join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir || isNonRoute(entry)) continue;
      // Route groups are transparent to the URL.
      walk(full, isGroup(entry) ? urlPath : `${urlPath}/${entry}`);
    }
  };

  walk(appDir, "");
  return [...new Set(routes)].sort();
}

export function scanMigrations(root: string): string[] {
  try {
    return readdirSync(path.join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

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

export function takeSnapshot(root: string, now = new Date()): RepoSnapshot {
  return {
    routes: scanRoutes(root),
    migrations: scanMigrations(root),
    files: readMountSites(root),
    now,
  };
}
