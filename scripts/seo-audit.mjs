/**
 * Lightweight, dependency-free static-analysis SEO checker (2026-08-16).
 *
 * WHY THIS SHAPE: it reads `.tsx` source as TEXT and pattern-matches, the
 * same way `lib/api/batch-quota.test.ts` and the other backfill scripts in
 * this repo already do — no ts-node, no build step, no importing TypeScript
 * modules through the `@/` alias (which a plain .mjs script can't resolve
 * anyway). Fast enough to re-run any time; not a replacement for actually
 * reading a page, just a fence against the specific regressions this audit
 * found once already: a real static page missing from the sitemap, an
 * indexable page with no canonical, two static pages sharing a title.
 *
 * Usage:
 *   npm run seo:audit
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "app");

/** Directories whose pages are intentionally private/utility, not indexable
 *  content — excluded from the "should this be in the sitemap" checks. */
const EXCLUDED_SEGMENTS = ["(app)", "admin", "api", "auth", "account"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

/** `app/(marketing)/[downloader]/page.tsx` -> `/[downloader]` (route group
 *  segments like `(marketing)` are stripped, same as Next's own routing). */
function routeFor(pageFile) {
  const rel = relative(APP_DIR, pageFile).replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
  const segments = rel.split("/").filter((s) => !s.startsWith("(") && s.length > 0);
  return "/" + segments.join("/");
}

function isDynamicRoute(route) {
  return route.includes("[");
}

function isExcluded(pageFile) {
  const rel = relative(APP_DIR, pageFile).replace(/\\/g, "/");
  return EXCLUDED_SEGMENTS.some((seg) => rel.includes(`${seg}/`) || rel.startsWith(`${seg}/`));
}

const pageFiles = walk(APP_DIR).filter((f) => !isExcluded(f));
const sitemapSrc = readFileSync(join(APP_DIR, "sitemap.ts"), "utf8");

const findings = { critical: [], high: [], medium: [], low: [] };
const push = (bucket, msg) => findings[bucket].push(msg);

// ── Per-page checks ──────────────────────────────────────────────────────
const staticTitles = new Map(); // title -> [routes]
const staticDescriptions = new Map();

for (const file of pageFiles) {
  const src = readFileSync(file, "utf8");
  const route = routeFor(file);
  const dynamic = isDynamicRoute(route);

  const hasMetadataExport = /export\s+const\s+metadata\s*:/.test(src) || /export\s+async\s+function\s+generateMetadata/.test(src);
  const hasCanonical = /alternates:\s*\{\s*canonical/.test(src);
  const explicitRobotsFalse = /robots:\s*\{\s*index:\s*false/.test(src);
  const explicitRobotsTrue = /robots:\s*\{\s*index:\s*true/.test(src);
  const isStaticGenerated = /dynamic\s*=\s*"force-static"/.test(src);

  if (!hasMetadataExport) {
    // The homepage deliberately inherits the root layout's title template
    // rather than redeclaring it (app/layout.tsx) — not a gap.
    if (route !== "/") push("medium", `${route} — no metadata/generateMetadata export (inherits root defaults)`);
    continue;
  }

  if (!hasCanonical && !explicitRobotsFalse) {
    push("high", `${route} — indexable but no alternates.canonical`);
  }

  if (!explicitRobotsFalse && !explicitRobotsTrue) {
    push("low", `${route} — indexability is implicit (no explicit robots field either way)`);
  }

  // Sitemap presence — only for genuinely static, non-dynamic-segment pages;
  // dynamic segments ([downloader], [slug], …) are driven by their own
  // generateStaticParams-fed list, checked separately below.
  if (isStaticGenerated && !dynamic && !explicitRobotsFalse) {
    const inSitemap = sitemapSrc.includes(`\`\${siteUrl}${route}\``) || sitemapSrc.includes(`"${route}"`) || route === "/";
    if (!inSitemap) {
      push("high", `${route} — static, indexable, not found in app/sitemap.ts`);
    }
  }

  // Duplicate title/description — literal strings only (static pages); the
  // ~148 generated downloader pages are computed, not literal, and are
  // already guaranteed-unique by construction (lib/seo/seo-pages.ts).
  const titleMatch = src.match(/title:\s*"([^"]+)"/);
  if (titleMatch) {
    const list = staticTitles.get(titleMatch[1]) ?? [];
    list.push(route);
    staticTitles.set(titleMatch[1], list);
  }
  const descMatch = src.match(/description:\s*"([^"]+)"/);
  if (descMatch) {
    const list = staticDescriptions.get(descMatch[1]) ?? [];
    list.push(route);
    staticDescriptions.set(descMatch[1], list);
  }
}

for (const [title, routes] of staticTitles) {
  if (routes.length > 1) push("critical", `Duplicate title "${title}" on: ${routes.join(", ")}`);
}
for (const [desc, routes] of staticDescriptions) {
  if (routes.length > 1) push("high", `Duplicate description "${desc.slice(0, 60)}…" on: ${routes.join(", ")}`);
}

// ── Orphan-page heuristic ────────────────────────────────────────────────
// A static route that never appears as an href/Link target anywhere in
// components/ or app/ (besides its own file) has no internal path to it.
// Approximate on purpose: dynamic segments and query-driven links can't be
// matched this way, so this only checks genuinely static, literal routes.
const sourceDirs = ["components", "features", "app", "lib"].map((d) => join(ROOT, d));
function allSourceText() {
  let combined = "";
  for (const dir of sourceDirs) {
    for (const file of walkAll(dir)) {
      if (/\.(tsx|ts)$/.test(file)) combined += readFileSync(file, "utf8") + "\n";
    }
  }
  return combined;
}
function walkAll(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

const corpus = allSourceText();
for (const file of pageFiles) {
  const route = routeFor(file);
  if (isDynamicRoute(route) || route === "/") continue;
  const src = readFileSync(file, "utf8");
  if (/robots:\s*\{\s*index:\s*false/.test(src)) continue; // intentionally private, not an orphan concern
  /*
    This codebase links the same way at least three different ways: a JSX
    attribute (`href="/about"`), an object-literal nav entry
    (`{ href: "/about" }`), and a bare `[label, href]` tuple
    (`["About Us", "/about"]`, site-footer.tsx's own convention). Trying to
    enumerate every authoring convention is a losing game for a regex — this
    just matches the quoted route string ANYWHERE, which trades a few false
    positives (a route string that happens to appear in an unrelated context)
    for not missing real links built from a data array. Treat a hit here as
    "worth checking by hand," not a certainty either way.
  */
  const escaped = route.replace(/[/[\]]/g, "\\$&");
  const barePattern = new RegExp(`(["'\`])${escaped}(?:["'\`/?#])`, "g");
  const occurrences = (corpus.match(barePattern) ?? []).length;
  if (occurrences === 0) {
    push("high", `${route} — no internal href found anywhere in components/features/app/lib (possible orphan)`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────
const order = ["critical", "high", "medium", "low"];
let total = 0;
for (const bucket of order) {
  if (findings[bucket].length === 0) continue;
  console.log(`\n${bucket.toUpperCase()} (${findings[bucket].length})`);
  for (const msg of findings[bucket]) {
    console.log(`  - ${msg}`);
    total++;
  }
}
console.log(`\n${total} finding(s) across ${pageFiles.length} page(s) checked (excluding ${EXCLUDED_SEGMENTS.join(", ")}).`);
if (findings.critical.length > 0) process.exitCode = 1;
