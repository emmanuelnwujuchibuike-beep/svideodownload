import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin-configurable pieces of the public landing page, stored in the `settings`
 * table under key `landing` — mirroring the monetization / pricing pattern, so an
 * operator can change what every visitor sees WITHOUT a redeploy.
 *
 * ── What lives here, and why only images ──────────────────────────────────────
 *
 * The landing is the front door and its 2-second budget is the project's #1 rule
 * (docs/rule-2-second-page-budget). So the copy, layout and effects are baked into
 * the static document; the only things an admin drives at runtime are two IMAGE
 * slots the redesign introduced, both decorative:
 *
 *  • `reelsPosterUrl` — the still image shown in the hero phone's reels tile. The
 *    landing mockup no longer PLAYS a reel (that experience moved to /reels in
 *    full screen); it shows one admin-chosen poster. Empty ⇒ the mockup falls back
 *    to a branded gradient tile, so the hero can never render a broken image.
 *
 *  • `feedGridImages` — up to four images for the 2×2 "feed grid" showcase section.
 *    ONLY admin-uploaded images appear there (never real user posts), so the
 *    section is empty until an operator fills it and renders nothing when empty —
 *    the same fail-closed rule the ad surfaces follow.
 *
 * ── How the STATIC landing reads this without un-caching itself ────────────────
 *
 * `getLandingSettings()` reads through the SERVICE-ROLE admin client, not a
 * request-scoped one — no cookies, no headers — exactly like
 * `getMonetizationSettings`. That keeps `/` statically generated (a cookie read
 * would opt the whole route out; see app/(marketing)/page.tsx). Admin changes
 * surface on the next ISR regeneration (app/layout.tsx `revalidate`), which is the
 * honest trade for a page that paints from the edge.
 */

/** How many images the 2×2 feed grid shows. Fixed by the design (a 2×2 grid). */
export const FEED_GRID_SLOTS = 4;

export interface LandingSettings {
  /** Still poster for the hero phone's reels tile. Empty ⇒ gradient fallback. */
  reelsPosterUrl: string;
  /** Up to FEED_GRID_SLOTS images for the 2×2 showcase grid. */
  feedGridImages: string[];
}

export const DEFAULT_LANDING: LandingSettings = {
  reelsPosterUrl: "",
  feedGridImages: [],
};

/** URLs we are willing to render on the public landing. */
function isAllowedImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  // Root-relative asset (e.g. /brand/…) or an absolute https URL. No data: URIs
  // (an admin field that reaches the page as an image src should not be able to
  // carry arbitrary inline payloads) and no http: (the site is https-only).
  return value.startsWith("/") || value.startsWith("https://");
}

/** Drop malformed entries and cap at FEED_GRID_SLOTS, so bad data can't reach the page. */
export function normalizeFeedGridImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isAllowedImageUrl).slice(0, FEED_GRID_SLOTS);
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: LandingSettings } | null = null;
/*
  Short TTL, same reasoning as monetization: `setLandingSettings` clears the cache
  on the instance that saved, but every OTHER instance keeps its copy until this
  expires. Ten seconds keeps the read cheap while making an admin change feel
  immediate on the operator's own request; visitors see it at the ISR cadence.
*/
const TTL_MS = 10_000;

/** Effective landing settings (defaults + admin overrides), normalised. */
export async function getLandingSettings(): Promise<LandingSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return DEFAULT_LANDING;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "landing")
      .maybeSingle();
    const raw = (data?.value ?? {}) as Partial<LandingSettings>;
    const value: LandingSettings = {
      reelsPosterUrl: isAllowedImageUrl(raw.reelsPosterUrl) ? raw.reelsPosterUrl : "",
      feedGridImages: normalizeFeedGridImages(raw.feedGridImages),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return DEFAULT_LANDING;
  }
}

/** Admin: persist the landing image slots. */
export async function setLandingSettings(s: LandingSettings): Promise<void> {
  const db = createAdminClient();
  const value: LandingSettings = {
    reelsPosterUrl: isAllowedImageUrl(s.reelsPosterUrl) ? s.reelsPosterUrl : "",
    feedGridImages: normalizeFeedGridImages(s.feedGridImages),
  };
  await db.from("settings").upsert({ key: "landing", value }, { onConflict: "key" });
  cache = null;
}
