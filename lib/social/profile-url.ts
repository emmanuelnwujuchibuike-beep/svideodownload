import { CATEGORIES } from "@/lib/social/categories";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROFILE URLS — https://www.frenzsave.com/chris (owner, 2026-10-17)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The canonical public profile URL is `/:handle`, no `/u/` prefix. The page
 * itself still lives at `app/u/[handle]` — `middleware.ts` REWRITES `/chris` to
 * it (the address bar keeps `/chris`), because `/:slug` is already the static
 * downloader route (`app/(marketing)/[downloader]`, dynamicParams = false) and
 * Next.js can't hold two dynamic segments at one level. A rewrite costs no
 * database query and no new page. Old `/u/chris` links get a permanent (308)
 * redirect to `/chris`, query string kept (referral codes, ?tab=…).
 *
 * Pure and edge-safe: used by the middleware, the server and the browser.
 *
 * Why the two can't collide:
 *   · a handle is `[a-z0-9_]{3,20}` — never a hyphen — and every downloader
 *     slug is `<stem>-<modifier>` (asserted in profile-url.test.ts);
 *   · every top-level route, category and public folder is RESERVED below, so
 *     no handle can shadow a page (a test fails if a new route isn't listed).
 *   · a handle that is reserved anyway (none existed on 2026-10-17) keeps
 *     working at `/u/<handle>` — it is never redirected onto a page.
 */

/** The one handle format: lowercase letters, digits, underscore; 3–20 long. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Names a handle may never take, because the path `/<name>` belongs to the app.
 * Top-level routes (app/, app/(app)/, app/(marketing)/), the category hubs that
 * share the downloader route, folders in public/, and the earlier reserved words.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // app/ and its route groups
  "about", "academy", "account", "admin", "advertise", "ai", "api", "auth", "blog", "contact", "create",
  "developers", "dmca", "downloads", "earn", "exclusive", "explore", "features", "feed", "friends",
  "glossary", "help", "history", "home", "learn", "library", "login", "members", "memories", "messages",
  "network", "notifications", "p", "pricing", "privacy", "profile", "quests", "r", "reels", "rewards",
  "saved", "search", "sound", "sounds", "studio", "sub", "support", "terms", "topics", "trust", "u",
  "unsubscribe", "wallet", "wallpapers", "welcome",
  // category hubs (served by the downloader route)
  ...CATEGORIES,
  // public/ folders and special files
  "brand", "splash", "sw", "launch", "robots", "sitemap", "manifest", "favicon", "icon", "apple_icon",
  // reserved before 2026-10-17 (lib/social/profile.ts), kept
  "logout", "settings", "go", "frenzsave", "trending",
  // obvious future routes, so they stay free
  "app", "www", "static", "assets", "_next", "status", "legal", "careers", "press", "jobs", "signup", "register", "new", "me",
]);

export const isReservedHandle = (h: string) => RESERVED_HANDLES.has(h.toLowerCase());

/** A handle that may live at `/<handle>`: the right shape and not reserved. */
export const isTopLevelHandle = (h: string) => HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h);

/**
 * The path of a profile (and its sub-pages). `profilePath("chris")` → `/chris`,
 * `profilePath("chris", "/followers")` → `/chris/followers`. A handle that can't
 * live at the top level (reserved, or a legacy value outside the format) keeps
 * the old `/u/` path, which still works — never a path that lands on a page.
 */
export function profilePath(handle: string | null | undefined, sub = ""): string {
  const h = String(handle ?? "").trim().replace(/^@/, "");
  const tail = sub && !sub.startsWith("/") && !sub.startsWith("?") && !sub.startsWith("#") ? `/${sub}` : sub;
  return isTopLevelHandle(h) ? `/${h}${tail}` : `/u/${encodeURIComponent(h)}${tail}`;
}

/** The handle a pathname shows a profile of (`/chris`, `/chris/followers`, `/u/chris`), or null. */
export function profileHandleFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const segs = pathname.split("/").filter(Boolean);
  if (segs[0] === "u") return segs[1] ? safeDecode(segs[1])?.toLowerCase() ?? null : null;
  const first = segs[0] ? safeDecode(segs[0]) : null;
  return first && isTopLevelHandle(first) ? first : null;
}

/** True on any profile page, old or new form. For route-type checks (ads, analytics, nav). */
export const isProfilePath = (pathname: string | null | undefined) => profileHandleFromPath(pathname) !== null;

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export type ProfileRoute = { kind: "redirect"; to: string } | { kind: "rewrite"; to: string };

/**
 * What the middleware does with a request path (search string passed separately and always kept):
 *   /u/chris[/x]  → redirect /chris[/x]      (old links; only for a handle that may live at the top)
 *   /Chris[/x]    → redirect /chris[/x]      (one canonical, lowercase — the store is lowercase)
 *   /chris[/x]    → rewrite  /u/chris[/x]    (served by app/u/[handle], the address bar keeps /chris)
 *   anything else → null (the app's own routing; an unknown name is the usual 404)
 */
export function profileRoute(pathname: string, search = ""): ProfileRoute | null {
  const segs = pathname.split("/");
  // segs[0] is "" (leading slash)
  if (segs.length < 2 || segs[0] !== "") return null;
  const q = search && !search.startsWith("?") ? `?${search}` : search;
  const rest = segs.length > 2 ? `/${segs.slice(2).join("/")}` : "";

  if (segs[1] === "u") {
    const raw = segs[2] ? safeDecode(segs[2]) : null;
    if (!raw) return null;
    const h = raw.toLowerCase();
    if (!isTopLevelHandle(h)) return null; // reserved / legacy: /u/ keeps serving it as before
    const after = segs.length > 3 ? `/${segs.slice(3).join("/")}` : "";
    return { kind: "redirect", to: `/${h}${after}${q}` };
  }

  const raw = segs[1] ? safeDecode(segs[1]) : null;
  if (!raw) return null;
  const h = raw.toLowerCase();
  if (!isTopLevelHandle(h)) return null;
  // the canonical spelling: lowercase and unencoded
  if (segs[1] !== h) return { kind: "redirect", to: `/${h}${rest}${q}` };
  return { kind: "rewrite", to: `/u/${h}${rest}${q}` };
}
