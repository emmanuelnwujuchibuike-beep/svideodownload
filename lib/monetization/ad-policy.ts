/**
 * Which pages may carry Google ads — the single, page-category source of truth.
 *
 * 🔴 PURE AND CLIENT-SAFE. No Supabase, no `server-only`, no React, no I/O.
 * The marketing layout imports it on the server and the unit guard imports it
 * in the browser, so it must stay importable from both.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The AdSense loader used to sit in the ROOT layout's <head>, which put it on
 * every route in the product: `/login`, `/admin`, all 27 `/account` settings
 * screens, `/studio`, `/messages`, `/create/*` and the download-processing
 * screens. Google's published policy is explicit that ads do not belong on
 * pages without publisher content, or on screens that are primarily a user
 * interacting with a tool — and "we render an ad component there" was never the
 * question, because Auto ads place themselves from the loader alone.
 *
 * So the decision moved out of "wherever a component happens to be mounted"
 * into one table that can be read, reviewed and tested.
 *
 * ── The three categories ────────────────────────────────────────────────
 *
 *   AD_SAFE_CONTENT     Real publisher content written by us: the landing page,
 *                       platform downloader pages and their articles, blog,
 *                       learn, academy, help, glossary, topics, trust and the
 *                       legal pages. Google ads are allowed.
 *
 *   LIMITED_AD_CONTENT  A real public page whose substance is USER-generated or
 *                       largely interactive — profiles, posts, feeds, sounds,
 *                       wallpapers. There is content, but it is not ours and it
 *                       is thin per page. Google ads are withheld here by
 *                       policy choice, not by accident: user-generated pages are
 *                       a routine rejection cause, and the upside is small.
 *
 *   NO_AD_CONTENT       Private, transactional or utility screens with little or
 *                       no publisher content: auth, admin, account settings, the
 *                       creator studio, messages, composers, the user's own
 *                       library and download screens. Google ads must never
 *                       appear.
 *
 * ── What this does NOT decide ───────────────────────────────────────────
 * It says nothing about Hilltop/VAST or the other networks. Those are gated
 * separately (`hilltop-config.ts`, `reward-networks.ts`) and answer a different
 * question — which is deliberate: conflating "may Google serve here" with "may
 * any ad run here" is how a policy rule turns into a monetisation switch and
 * quietly drifts.
 */

export type AdPolicy = "AD_SAFE_CONTENT" | "LIMITED_AD_CONTENT" | "NO_AD_CONTENT";

/**
 * Path prefixes that may never carry Google ads.
 *
 * Prefixes, not exact matches, because every one of these owns a subtree and a
 * page added under it later must inherit the rule rather than have to remember
 * it. `/account/analytics` was not enumerated anywhere before; it simply had
 * ads because the loader was global.
 */
const NO_AD_PREFIXES = [
  // Authentication and onboarding — no publisher content, and a sign-in screen
  // carrying ads is one of the clearest policy problems a reviewer can find.
  "/login",
  "/signup",
  "/register",
  "/auth",
  "/welcome",
  "/logout",

  // Staff-only.
  "/admin",

  // Private member settings — 27 screens of forms.
  "/account",

  // Creator Studio: a private dashboard of the member's own numbers.
  "/studio",

  // Private messaging. Ads beside a stranger's DMs is its own problem.
  "/messages",

  // Composers and other tools: interaction, not content.
  "/create",

  // The member's own files, history and saved items. Transactional utility
  // screens, and the download experience Google ads must stay away from.
  "/downloads",
  "/download",
  "/saved",
  "/library",
  "/history",

  // Social graph management screens.
  "/friends",
  "/notifications",

  // Search results and empty states are query-parameter pages with no content
  // of ours on them.
  "/search",

  // Developer/API console.
  "/developers/keys",
] as const;

/**
 * Public but user-generated. Real pages, indexed where appropriate, simply not
 * where we choose to run Google's inventory.
 */
const LIMITED_AD_PREFIXES = [
  "/feed",
  "/explore",
  "/reels",
  "/home",
  "/u/", // member profiles
  "/p/", // individual posts
  "/sound/",
  "/sounds",
  "/wallpapers",
  "/profile",
  // Commercial/transactional: our own conversion page. Not a policy problem,
  // but an ad competing with the checkout is a bad trade.
  "/pricing",
  "/checkout",
] as const;

/** Normalise for matching: lower-case, strip the query and any trailing slash. */
function normalise(pathname: string): string {
  const path = (pathname || "/").split("?")[0]!.split("#")[0]!.toLowerCase();
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * A prefix matches when the path IS it, or continues with `/`.
 *
 * The distinction matters: `/downloads` must not swallow a future
 * `/downloads-explained` article, and `/p/` must not swallow `/pricing`.
 * Prefixes written with a trailing slash are matched as written.
 */
function hasPrefix(path: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The policy for a pathname.
 *
 * 🔴 Defaults to AD_SAFE_CONTENT only for paths that are genuinely ours. An
 * UNKNOWN path defaults to NO_AD_CONTENT — fail closed. A route added tomorrow
 * gets no ads until somebody decides it should, which is the safe direction for
 * a rule whose failure mode is a policy violation.
 */
export function adPolicyFor(pathname: string): AdPolicy {
  const path = normalise(pathname);

  for (const prefix of NO_AD_PREFIXES) {
    if (hasPrefix(path, prefix)) return "NO_AD_CONTENT";
  }
  for (const prefix of LIMITED_AD_PREFIXES) {
    if (hasPrefix(path, prefix)) return "LIMITED_AD_CONTENT";
  }
  if (isPublisherContent(path)) return "AD_SAFE_CONTENT";
  return "NO_AD_CONTENT";
}

/**
 * The publisher-content surface: pages whose words we wrote.
 *
 * Enumerated rather than inferred. "Anything not private is content" is how a
 * new utility screen silently becomes an ad page.
 */
const CONTENT_ROOTS = [
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/dmca",
  "/trust",
  "/help",
  "/support",
  "/blog",
  "/learn",
  "/academy",
  "/glossary",
  "/topics",
  "/features",
  "/developers",
] as const;

/**
 * Reserved first segments — everything that is NOT a platform downloader page.
 *
 * The downloader lives on a catch-all route (`/[downloader]`), so a single
 * unknown segment like `/tiktok-downloader` is a real content page while
 * `/some-random-thing` is a 404. Rather than duplicate the platform list here
 * (it would drift), anything that is not a known app path and looks like a
 * downloader slug is treated as content — and the slug shape is deliberately
 * narrow.
 */
function isPublisherContent(path: string): boolean {
  if (path === "/") return true;
  for (const root of CONTENT_ROOTS) {
    if (hasPrefix(path, root)) return true;
  }
  /*
    A platform downloader page, or one of its dated articles:
      /tiktok-downloader
      /instagram-downloader/2026/09/how-to-save-a-reel
    Lower-case letters, digits and hyphens only. A path with an uppercase
    letter, an underscore or a dot is not one of ours.
  */
  return /^\/[a-z0-9-]+(\/\d{4}\/\d{2}\/[a-z0-9-]+)?$/.test(path);
}

/** Convenience: may Google's inventory run on this path at all? */
export function allowsGoogleAds(pathname: string): boolean {
  return adPolicyFor(pathname) === "AD_SAFE_CONTENT";
}
