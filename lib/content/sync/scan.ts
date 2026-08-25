import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Repository inventory — routes and migrations, by name.
 *
 * 🔴 THIS FILE MUST IMPORT NOTHING BUT NODE BUILT-INS.
 *
 * `next.config.ts` imports it to take the inventory at BUILD time (see the
 * `env` block there and lib/content/sync/snapshot.ts for why). A Next config is
 * evaluated in every build worker, so anything this file pulls in is pulled
 * into config evaluation too — importing it from `snapshot.ts` dragged in
 * `detect.ts`'s registry graph and the build died with a Windows stack overflow
 * (exit 3221226505) part-way through "Collecting page data".
 *
 * Keep it free of `@/` imports, and free of type imports from modules that have
 * runtime dependencies of their own.
 */

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
