/**
 * The page registry — every surface the admin dashboard reports on.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * "Top pages" was a raw top-8 tally of `analytics_events.path`. Two problems
 * with that, and the owner hit both:
 *
 *   1. A page outside the top 8 is INVISIBLE. Wallpapers could be getting real
 *      traffic and simply never appear, which reads as "it isn't tracked".
 *   2. Dynamic routes shred the tally: every `/u/<handle>` and `/p/<id>` is its
 *      own key, so profiles collectively out-rank everything while no single
 *      row is large enough to show.
 *
 * So the dashboard now reports on a CATALOGUE of real surfaces. Every page
 * listed here appears in the dashboard whether or not it has traffic — a zero
 * is information, and it is the only way "is anyone using this?" has an answer.
 * Dynamic routes collapse into one row (all profiles, all posts).
 *
 * Same catalogue pattern as `lib/platform/data-domains.ts`, and kept honest the
 * same way: `pages.test.ts` asserts every entry matches its own sample path and
 * that no two entries claim the same path.
 *
 * Pure data + one matcher: no React, no Supabase.
 */

export type PageGroup =
  | "Acquisition"
  | "Downloader"
  | "Social"
  | "Profile & account"
  | "Content"
  | "Support & legal"
  | "Admin";

export interface PageSpec {
  /** Stable id, used as the tally key. */
  id: string;
  label: string;
  group: PageGroup;
  /**
   * Exact paths this page owns. Checked before `pattern`, so `/account` does
   * not swallow `/account/privacy`.
   */
  exact?: string[];
  /** Regex for dynamic routes. Anchored at both ends by convention. */
  pattern?: RegExp;
  /** A path that MUST match — the test's proof the matcher works. */
  sample: string;
}

export const PAGES: PageSpec[] = [
  /* ───────────────────────── Acquisition ───────────────────────── */
  { id: "home", label: "Landing page", group: "Acquisition", exact: ["/"], sample: "/" },
  { id: "features", label: "Features", group: "Acquisition", exact: ["/features"], sample: "/features" },
  { id: "pricing", label: "Pricing", group: "Acquisition", exact: ["/pricing"], sample: "/pricing" },
  { id: "welcome", label: "Welcome", group: "Acquisition", exact: ["/welcome"], sample: "/welcome" },
  { id: "login", label: "Sign in", group: "Acquisition", exact: ["/login", "/login/mfa-challenge"], sample: "/login" },
  { id: "about", label: "About", group: "Acquisition", exact: ["/about"], sample: "/about" },
  { id: "developers", label: "Developers", group: "Acquisition", exact: ["/developers"], sample: "/developers" },

  /* ────────────────────────── Downloader ───────────────────────── */
  { id: "downloads", label: "Download hub", group: "Downloader", exact: ["/downloads"], sample: "/downloads" },
  { id: "history", label: "Download history", group: "Downloader", exact: ["/history"], sample: "/history" },
  { id: "library", label: "Library", group: "Downloader", exact: ["/library"], sample: "/library" },
  // Per-platform landing pages (/tiktok, /instagram …) — one row, since the
  // platform split already has its own card.
  {
    id: "platform-landing",
    label: "Platform pages",
    group: "Downloader",
    pattern: /^\/(tiktok|instagram|facebook|twitter|x|youtube|snapchat|pinterest|telegram|reddit|linkedin|vimeo|threads)$/,
    sample: "/tiktok",
  },

  /* ──────────────────────────── Social ─────────────────────────── */
  { id: "wallpapers", label: "Wallpapers", group: "Social", exact: ["/wallpapers"], sample: "/wallpapers" },
  { id: "feed", label: "Home feed", group: "Social", exact: ["/home"], sample: "/home" },
  { id: "reels", label: "Reels", group: "Social", exact: ["/reels"], sample: "/reels" },
  { id: "explore", label: "Explore", group: "Social", exact: ["/explore"], sample: "/explore" },
  { id: "search", label: "Search", group: "Social", exact: ["/search"], sample: "/search" },
  { id: "post", label: "Posts", group: "Social", pattern: /^\/p\/[^/]+$/, sample: "/p/abc123" },
  { id: "create", label: "Create", group: "Social", pattern: /^\/create(\/.*)?$/, sample: "/create/post" },
  { id: "messages", label: "Messages", group: "Social", pattern: /^\/messages(\/.*)?$/, sample: "/messages/42" },
  { id: "friends", label: "Friends", group: "Social", pattern: /^\/friends(\/.*)?$/, sample: "/friends/discover" },
  { id: "notifications", label: "Notifications", group: "Social", exact: ["/notifications"], sample: "/notifications" },
  { id: "saved", label: "Saved", group: "Social", exact: ["/saved"], sample: "/saved" },

  /* ───────────────────── Profile & account ─────────────────────── */
  { id: "profile-public", label: "Member profiles", group: "Profile & account", pattern: /^\/u\/[^/]+(\/.*)?$/, sample: "/u/emily" },
  { id: "profile-doorway", label: "Profile doorway", group: "Profile & account", exact: ["/profile"], sample: "/profile" },
  { id: "settings", label: "Settings", group: "Profile & account", exact: ["/account"], sample: "/account" },
  {
    id: "settings-detail",
    label: "Settings — sub-pages",
    group: "Profile & account",
    pattern: /^\/account\/.+$/,
    sample: "/account/privacy",
  },

  /* ──────────────────────────── Content ────────────────────────── */
  { id: "blog", label: "Blog", group: "Content", pattern: /^\/blog(\/.*)?$/, sample: "/blog/post-slug" },
  { id: "learn", label: "Learn", group: "Content", pattern: /^\/learn(\/.*)?$/, sample: "/learn/guide" },
  { id: "academy", label: "Academy", group: "Content", pattern: /^\/academy(\/.*)?$/, sample: "/academy/school" },
  { id: "topics", label: "Topics", group: "Content", pattern: /^\/topics(\/.*)?$/, sample: "/topics/saving-video" },
  { id: "glossary", label: "Glossary", group: "Content", exact: ["/glossary"], sample: "/glossary" },

  /* ─────────────────────── Support & legal ─────────────────────── */
  { id: "help", label: "Help centre", group: "Support & legal", pattern: /^\/help(\/.*)?$/, sample: "/help/getting-started" },
  { id: "support", label: "Support", group: "Support & legal", exact: ["/support"], sample: "/support" },
  { id: "contact", label: "Contact", group: "Support & legal", exact: ["/contact"], sample: "/contact" },
  { id: "trust", label: "Trust centre", group: "Support & legal", pattern: /^\/trust(\/.*)?$/, sample: "/trust/who-can-see-what-you-share" },
  {
    id: "legal",
    label: "Legal",
    group: "Support & legal",
    exact: ["/privacy", "/terms", "/dmca"],
    sample: "/privacy",
  },

  /* ───────────────────────────── Admin ─────────────────────────── */
  { id: "admin", label: "Admin dashboard", group: "Admin", pattern: /^\/admin(\/.*)?$/, sample: "/admin/content" },
];

/** Rows the dashboard renders, in catalogue order, grouped. */
export const PAGE_GROUPS: PageGroup[] = [
  "Acquisition",
  "Downloader",
  "Social",
  "Profile & account",
  "Content",
  "Support & legal",
  "Admin",
];

const EXACT = new Map<string, string>();
for (const p of PAGES) for (const e of p.exact ?? []) EXACT.set(e, p.id);

/**
 * Which catalogued page does this path belong to? Returns null for anything
 * uncatalogued, which the dashboard reports as "Other" rather than dropping —
 * an unrecognised path is a page somebody forgot to catalogue, and hiding it
 * would hide that fact.
 */
export function matchPage(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  // Query strings and fragments are not part of a page's identity, and a
  // trailing slash is the same page.
  let path = rawPath.split("?")[0]!.split("#")[0]!;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path.startsWith("/")) return null;

  const exact = EXACT.get(path);
  if (exact) return exact;

  for (const p of PAGES) {
    if (p.pattern?.test(path)) return p.id;
  }
  return null;
}

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));

export function pageSpec(id: string): PageSpec | undefined {
  return BY_ID.get(id);
}
