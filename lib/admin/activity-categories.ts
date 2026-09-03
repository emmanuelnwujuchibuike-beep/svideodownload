import { NOTABLE } from "./activity-format";

/**
 * The live feed's categories — Ads, Downloads, Installs and the rest.
 *
 * Owner, 2026-09-03: "separate the ad stat from download, and separate other
 * stats like install, and all to be all separated in a top nav that when click
 * on install shows all recent install in the last 24hrs and when clicks on ad it
 * shows all ad stats in the last 24hs and same for other stats."
 *
 * ── Why the mapping lives here, and is derived ────────────────────────────────
 *
 * One mixed stream is fine for "what is happening right now" and useless for
 * "how did installs do today" — a single install is three screens down behind
 * two hundred ad impressions. The categories are the answer to the second
 * question.
 *
 * `EVENT_KINDS` is derived from `NOTABLE`, the same set the feed query already
 * filters on, so a category can never ask the database for an event type the
 * feed does not carry. A kind nobody classified lands in `other` rather than
 * disappearing — an unclassified row must still be reachable, because the row
 * an operator most needs is usually the one nobody anticipated.
 *
 * ── The 24-hour window is the CALLER'S job ────────────────────────────────────
 *
 * Nothing here knows about time. The route turns a category into a `kinds`
 * filter and a `since` cursor; keeping the two apart is what lets the live feed
 * reuse the same function with no window at all.
 */

export const ACTIVITY_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "ads", label: "Ads" },
  { id: "downloads", label: "Downloads" },
  { id: "installs", label: "Installs" },
  { id: "members", label: "Members" },
  { id: "api", label: "API" },
  { id: "other", label: "Other" },
] as const;

export type ActivityCategoryId = (typeof ACTIVITY_CATEGORIES)[number]["id"];

const CATEGORY_IDS = new Set<string>(ACTIVITY_CATEGORIES.map((c) => c.id));

export function isActivityCategory(value: unknown): value is ActivityCategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

/**
 * The synthetic kind the feed gives a row from the `downloads` table. It is not
 * an `events` row, so it is never in NOTABLE and has to be named explicitly.
 */
export const DOWNLOAD_KIND = "download";

/*
  Prefixes first, because the ad families grow: every ExoClick `banner_*` /
  `interstitial_*`, every Monetag `monetag_*`, and the AdSense-era `ad_*` are
  all "ads" without anyone having to add a row here when a placement ships.
  That is the same reasoning /api/track's slot list follows — a hand-maintained
  list of this shape has already gone stale twice in this codebase.
*/
const AD_PREFIXES = ["ad_", "banner_", "interstitial_", "monetag_", "reward_"];
const AD_EXACT = new Set(["affiliate_click"]);
const DOWNLOAD_PREFIXES = ["batch_"];
const INSTALL_KINDS = new Set(["pwa_installed"]);
const MEMBER_KINDS = new Set(["subscribe", "subscribe_cancel", "upgrade_prompt_view"]);
const API_KINDS = new Set(["api_key_created"]);

/** Which category a feed row belongs to. Never throws; unknown ⇒ `other`. */
export function categoryOf(kind: string): Exclude<ActivityCategoryId, "all"> {
  if (kind === DOWNLOAD_KIND || DOWNLOAD_PREFIXES.some((p) => kind.startsWith(p))) return "downloads";
  if (AD_EXACT.has(kind) || AD_PREFIXES.some((p) => kind.startsWith(p))) return "ads";
  if (INSTALL_KINDS.has(kind)) return "installs";
  if (MEMBER_KINDS.has(kind)) return "members";
  if (API_KINDS.has(kind)) return "api";
  return "other";
}

/** Every event type the feed carries, plus the synthetic download row. */
const ALL_KINDS: string[] = [...NOTABLE, DOWNLOAD_KIND];

/**
 * The kinds a category covers, or null for `all` (meaning "do not filter").
 *
 * Null rather than "every kind": passing the full list to the query would work
 * but would also silently stop matching anything new, which is exactly the
 * staleness this module is arranged to avoid.
 */
export function kindsInCategory(id: ActivityCategoryId): string[] | null {
  if (id === "all") return null;
  return ALL_KINDS.filter((k) => categoryOf(k) === id);
}

/** Does this category need the `downloads` table at all? */
export function categoryNeedsDownloads(id: ActivityCategoryId): boolean {
  return id === "all" || categoryOf(DOWNLOAD_KIND) === id;
}
