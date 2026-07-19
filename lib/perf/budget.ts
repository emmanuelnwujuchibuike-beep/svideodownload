import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Route weight budget — Performance Platform, observability half.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * The 2-second page budget is the owner's first rule, and until now it has been a
 * CONVENTION: enforced by remembering it, and audited by measuring pages after
 * they shipped. That works right up until it doesn't, and the failure is always
 * the same shape — a page gains an import, nobody notices, and the regression is
 * discovered weeks later by someone on a slow connection.
 *
 * JavaScript weight is not the whole of load time, but it is the part that is
 * deterministic at build time, and on the slow-4G-plus-weak-CPU profile this
 * audience actually uses it is usually the dominant term. Bytes must be
 * downloaded on a constrained link, then parsed and executed on a constrained
 * CPU — the second cost is the one people forget, and it does not improve when
 * the network does.
 *
 * ── Deliberately measuring the build, not the browser ─────────────────────────
 *
 * Every browser-based performance check on this project has been flaky: localhost
 * reported /login CLS as 0.0009 when the live site measured 0.1614, and TTFB has
 * swung 49ms to 833ms between identical runs. A build artifact does not vary. So
 * this measures what is deterministic and leaves the rest to real-user vitals
 * (features/perf/web-vitals → /api/vitals), which sample actual devices.
 *
 * Pure filesystem reads, no I/O beyond that, so it can run in a test.
 */

export interface RouteWeight {
  /** Manifest key, e.g. `/(marketing)/academy/page`. */
  route: string;
  /**
   * Sum of unique JS chunks, GZIPPED — the First Load JS approximation.
   *
   * Compressed, not raw, because raw is roughly 3.8x larger here and a budget
   * stated in numbers that do not match what Next reports or what a browser
   * downloads is a budget nobody trusts or acts on. Real transfer uses brotli and
   * will be a little smaller again, so gzip is the conservative choice: it never
   * flatters the result.
   */
  bytes: number;
  chunks: number;
}

/* Compressing every chunk for every route is the same file many times over —
   shared chunks appear in almost all 252 routes. Cached by path. */
const gzipCache = new Map<string, number>();

function gzippedSize(absPath: string): number {
  const cached = gzipCache.get(absPath);
  if (cached !== undefined) return cached;

  let size = 0;
  try {
    size = gzipSync(readFileSync(absPath)).byteLength;
  } catch {
    /* Missing file: a partial or mid-write build. Skipping beats reporting a
       confidently wrong number. */
  }

  gzipCache.set(absPath, size);
  return size;
}

const NEXT_DIR = path.resolve(__dirname, "../../.next");
const MANIFEST = path.join(NEXT_DIR, "app-build-manifest.json");

/** Whether a production build exists to measure. */
export function buildExists(): boolean {
  return existsSync(MANIFEST);
}

/**
 * Per-route JS weight, derived from the build manifest.
 *
 * Shared chunks are counted once per route, because that is what a visitor
 * actually downloads for a cold entry to that route. It intentionally does NOT
 * model warm-cache navigation — the budget exists for the first visit, which is
 * the one that decides whether someone stays.
 */
export function routeWeights(): RouteWeight[] {
  if (!buildExists()) return [];

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    pages: Record<string, string[]>;
  };

  return Object.entries(manifest.pages)
    .map(([route, files]) => {
      const unique = [...new Set(files)];
      // Manifest paths are relative to .next/.
      const bytes = unique.reduce((sum, file) => sum + gzippedSize(path.join(NEXT_DIR, file)), 0);

      return { route, bytes, chunks: unique.length };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

/** Routes over a byte budget, heaviest first. */
export function overBudget(budgetBytes: number): RouteWeight[] {
  return routeWeights().filter((r) => r.bytes > budgetBytes);
}

export function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} kB`;
}
