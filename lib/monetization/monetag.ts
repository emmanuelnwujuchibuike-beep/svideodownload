/**
 * Monetag — the ad-type registry, snippet parser and tag resolver.
 *
 * ── Why Monetag is not an `ads`-table row ─────────────────────────────────────
 *
 * The `ads` table (see `ad-schema.ts`) is for PLACED units — a banner in a page
 * ZONE, rendered where an operator puts it. Monetag's products are the opposite:
 * a Multitag, In-Page Push, Push Notifications, a Vignette Banner and OnClick /
 * Popunder are all SELF-PLACING site-level loader `<script>` tags — Monetag itself
 * decides where and when they appear, from one tag in `<head>`. So they belong to
 * the site-level monetization settings and are emitted by `MonetagScript`, exactly
 * like the AdSense site script — not to the zone table.
 *
 * ── One tag per Monetag type ──────────────────────────────────────────────────
 *
 * Monetag's dashboard hands out a separate zone (a distinct `data-zone` id + JS
 * tag) per format. Adsterra's formats differ from Monetag's, so Monetag gets its
 * OWN typed units rather than being crammed into the banner-shaped `ads` row. The
 * legacy single `monetagSnippet` remains the primary Multitag (unchanged, so a
 * stored config is not disturbed); `monetagUnits` carries the per-type tags.
 *
 * ── Parsed, never injected ────────────────────────────────────────────────────
 *
 * Every snippet is PARSED into a structured `{ src, zone }` and re-emitted as a
 * real `<script>` — an admin free-text field that reached `<head>` as markup would
 * be a stored-XSS primitive. Only a clean `https` script URL is ever accepted;
 * anything else resolves to nothing. Same discipline as `verificationTags` and the
 * original `MonetagScript`.
 */

/** Every Monetag ad type the dashboard offers, in operator terms. */
export const MONETAG_AD_TYPES = [
  {
    id: "multitag",
    label: "Multitag",
    description: "One tag that serves all Monetag formats — the site-wide default.",
  },
  {
    id: "in_page_push",
    label: "In-Page Push",
    description: "A native-style push widget rendered in the page. No browser permission needed.",
  },
  {
    id: "push_notification",
    label: "Push Notifications",
    description:
      "Browser / OS push subscriptions. Monetag may also verify this via the service worker (already merged into /sw.js).",
  },
  {
    id: "vignette_banner",
    label: "Vignette Banner",
    description: "A full-screen interstitial shown between page views.",
  },
  {
    id: "onclick_popunder",
    label: "OnClick (Popunder)",
    description: "Opens a monetised tab on the visitor's click. High-yield, but may affect an AdSense review.",
  },
] as const;

export type MonetagAdType = (typeof MONETAG_AD_TYPES)[number]["id"];

/** Just the ids, for the API enum and validation. */
export const MONETAG_AD_TYPE_IDS = MONETAG_AD_TYPES.map((t) => t.id) as [MonetagAdType, ...MonetagAdType[]];

const TYPE_SET = new Set<string>(MONETAG_AD_TYPE_IDS);

/** Whether a value is a known Monetag ad type. Fails closed on anything else. */
export function isMonetagAdType(value: unknown): value is MonetagAdType {
  return typeof value === "string" && TYPE_SET.has(value);
}

/** Admin display metadata for a type id (falls back to the raw id). */
export function monetagTypeMeta(id: string): { id: string; label: string; description: string } {
  return MONETAG_AD_TYPES.find((t) => t.id === id) ?? { id, label: id, description: "" };
}

/**
 * One configured Monetag tag: a type + the snippet pasted from the dashboard.
 *
 * Stored in `MonetizationSettings.monetagUnits`. Deliberately holds the raw
 * snippet (not a pre-parsed `{ src, zone }`) so the operator always sees exactly
 * what they pasted and re-parsing stays the single source of truth — the same
 * reason `monetagSnippet` is stored verbatim.
 */
export interface MonetagUnit {
  type: MonetagAdType;
  snippet: string;
}

/* ─────────────────────────────── page scope ─────────────────────────────────
 * Which pages Monetag may show on. The owner asked to pick pages rather than run
 * it site-wide, so Monetag is scoped to named SURFACES. The plan gate already
 * decides WHO sees ads (free/anon only); this decides WHERE.
 *
 * Matching is done on the CLIENT against `usePathname()` (the same reason the plan
 * gate is client-side — the server `<head>` can't read the path without
 * un-static-ing the marketing pages). So these matchers are pure + tested.
 */

export const MONETAG_SURFACES = [
  { id: "home", label: "Home page", hint: "The landing page (/)." },
  { id: "downloader", label: "Downloader pages", hint: "Every per-platform download & SEO page — the highest-traffic ad surface." },
  { id: "content", label: "Blog, Academy & Help", hint: "/blog, /academy, /learn, /glossary, /topics, /help." },
  { id: "info", label: "Info & legal", hint: "/about, /contact, /pricing, /features, /developers, /privacy, /terms, /dmca, /trust, /library." },
  { id: "app", label: "The app (signed-in)", hint: "/home, /downloads, /reels, messaging, and the rest of the app." },
] as const;

export type MonetagSurfaceId = (typeof MONETAG_SURFACES)[number]["id"];

export const MONETAG_SURFACE_IDS = MONETAG_SURFACES.map((s) => s.id) as [MonetagSurfaceId, ...MonetagSurfaceId[]];

const SURFACE_SET = new Set<string>(MONETAG_SURFACE_IDS);

/** Whether a value is a known Monetag surface id. */
export function isMonetagSurfaceId(value: unknown): value is MonetagSurfaceId {
  return typeof value === "string" && SURFACE_SET.has(value);
}

const CONTENT_RE = /^\/(blog|academy|learn|glossary|topics|help)(\/|$)/;
const INFO_RE = /^\/(about|contact|pricing|features|developers|privacy|terms|dmca|trust|library)(\/|$)/;
const APP_RE = /^\/(home|downloads|reels|explore|friends|messages|notifications|saved|search|account|create)(\/|$)/;
// Operator, auth and dynamic entity pages are never a Monetag surface.
const SYSTEM_RE = /^\/(admin|login|welcome|auth|api|p|u)(\/|$)/;

/**
 * Which surface a path belongs to, or null for a page Monetag never shows on
 * (system/auth/operator pages). A single top-level segment that isn't a known
 * static route is a per-platform downloader/SEO page — those render at `/<slug>`
 * from SEO_SLUGS, and are the main ad surface.
 */
export function resolveMonetagSurface(pathname: string): MonetagSurfaceId | null {
  const p = pathname || "/";
  if (p === "/") return "home";
  if (CONTENT_RE.test(p)) return "content";
  if (INFO_RE.test(p)) return "info";
  if (APP_RE.test(p)) return "app";
  if (SYSTEM_RE.test(p)) return null;
  if (/^\/[^/]+\/?$/.test(p)) return "downloader";
  return null;
}

/**
 * Whether Monetag may show on this path given the owner's page scope. `allPages`
 * (the default) shows everywhere; otherwise only the selected surfaces. A page
 * that resolves to no surface (system/auth) never shows Monetag.
 */
export function monetagAllowedOnPath(
  pathname: string,
  scope: { monetagAllPages: boolean; monetagSurfaces: string[] },
): boolean {
  if (scope.monetagAllPages) return true;
  const surface = resolveMonetagSurface(pathname);
  return surface !== null && (scope.monetagSurfaces ?? []).includes(surface);
}

/** A resolved, renderable Monetag tag. */
export interface MonetagTag {
  type: MonetagAdType;
  /** Always an https URL — the only shape accepted. */
  src: string;
  /** The numeric Monetag zone id, when present in the snippet. */
  zone: string | null;
  /** Whether Cloudflare's Rocket Loader must skip this script (`data-cfasync=false`). */
  cfAsync: boolean;
}

/**
 * Extract the https script URL, `data-zone` and `data-cfasync` from a pasted
 * Monetag snippet. Returns null for anything that is not a clean https script tag
 * — inline code, raw markup, an http URL or an empty string all resolve to
 * nothing, never to something injected.
 */
export function parseMonetagSnippet(snippet: string | null | undefined): {
  src: string;
  zone: string | null;
  cfAsync: boolean;
} | null {
  const s = (snippet ?? "").trim();
  if (!s) return null;

  const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
  let src = (srcMatch?.[1] ?? "").trim();
  if (src.startsWith("//")) src = `https:${src}`;
  // Only a clean https script URL — never inline code, markup or http.
  if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) return null;

  const zone = s.match(/data-zone\s*=\s*["']?(\d{1,20})["']?/i)?.[1] ?? null;
  const cfAsync = /data-cfasync\s*=\s*["']?false["']?/i.test(s);
  return { src, zone, cfAsync };
}

/**
 * Resolve every renderable Monetag tag from the settings — the legacy Multitag
 * (`monetagSnippet`) plus each `monetagUnits` entry — parsed, validated and
 * de-duplicated by (src + zone) so the same tag pasted twice loads once.
 *
 * Returns nothing when the master `monetag` switch is off, so a single toggle
 * silences every Monetag format at once.
 */
export function resolveMonetagTags(input: {
  monetag: boolean;
  monetagSnippet: string;
  monetagUnits: MonetagUnit[];
}): MonetagTag[] {
  if (!input.monetag) return [];

  const out: MonetagTag[] = [];
  const seen = new Set<string>();

  const add = (type: MonetagAdType, snippet: string) => {
    const parsed = parseMonetagSnippet(snippet);
    if (!parsed) return;
    const key = `${parsed.src}|${parsed.zone ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, ...parsed });
  };

  // The primary Multitag stays in its own field for back-compat.
  add("multitag", input.monetagSnippet ?? "");
  for (const unit of input.monetagUnits ?? []) {
    if (isMonetagAdType(unit?.type)) add(unit.type, unit?.snippet ?? "");
  }

  return out;
}
