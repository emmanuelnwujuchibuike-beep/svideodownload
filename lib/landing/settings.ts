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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE SHAPE OF EACH SLOT — the fix for "it's zooming one-sided"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-10, pointing at a screenshot of the "Position your photo"
 * dialog: "i think this is what causing it."
 *
 * They were right, and it is the whole bug. Every one of these three slots was
 * uploaded through `ImageUpload kind="banner"`, which cropped to a hardcoded
 * 16:9 — while the places the images actually render are nothing like 16:9:
 *
 *   • the hero phone's poster is a TALL window inside a phone frame;
 *   • the Wallpaper Gallery tile is roughly SQUARE;
 *   • the feed-grid cells are 4:5 PORTRAIT.
 *
 * So the operator framed a photo in a wide rectangle, the site then had to
 * squeeze that wide rectangle into a tall hole, and whatever it did next was
 * wrong: `cover` threw away half the width (the one-sided zoom), `contain`
 * letterboxed it, and the blurred-backdrop compromise that followed filled the
 * bands with mush. None of those is fixable at the render site, because the
 * information — which part of the photo matters — was discarded at upload.
 *
 * Cropping to the DESTINATION shape removes the mismatch instead of decorating
 * it. The dialog's promise, "everything inside the frame is what people will
 * see", becomes literally true, and the render sites go back to a plain
 * `object-cover` that has nothing left to crop.
 *
 * 🔴 These are width ÷ height and they are MEASURED against the rendered box,
 * not guessed. If a layout changes shape, re-measure and change it here — a
 * stale number here silently reintroduces the exact bug this replaces.
 *
 * 🔴 Images uploaded BEFORE this existed are still 16:9 files. They will be
 * centre-cropped by `object-cover` until they are re-uploaded through the new
 * frame; there is no way to recover framing that was never recorded.
 */
export const LANDING_IMAGE_ASPECT = {
  /**
   * The phone mockup's media window (`components/landing/phone-mockup.tsx`).
   *
   * Measured 265.6×367.4 CSS px = 0.723, and IDENTICAL at 360/393/430/768/1280
   * because the device frame is capped at `max-w-[300px]`. So this one is exact:
   * a photo cropped here fills that window with nothing left over.
   */
  reelsPoster: 0.72,
  /**
   * The Wallpaper Gallery tile in its `card` variant
   * (`components/wallpapers/wallpaper-cta.tsx`).
   *
   * 🔴 This slot has NO single shape, which is worth stating rather than hiding
   * behind a tidy-looking fraction. The tile is a grid cell that stretches to
   * whatever height its "Explore Features" sibling needs, so its own aspect
   * moves with the viewport — measured 0.721 at 360px, 0.869 at 393px and 1.057
   * at 430px, and the WIDE `row` variant on /downloads is 2.1–2.6 on top of
   * that.
   *
   * 7/8 is the value that minimises the worst case across the phone range: no
   * more than ~18% trimmed at either end, symmetrically, which reads as a
   * cropped photo rather than as the one-sided magnification being fixed here.
   * Re-measure if that row's layout changes.
   */
  wallpaperCta: 7 / 8,
  /**
   * The 2×2 showcase cells (`components/landing/feed-grid-gallery.tsx`).
   * `aspect-[4/5]`, verified 0.800 at every width. Exact.
   */
  feedGrid: 4 / 5,
} as const;

export interface LandingSettings {
  /** Still poster for the hero phone's reels tile. Empty ⇒ gradient fallback. */
  reelsPosterUrl: string;
  /** Up to FEED_GRID_SLOTS images for the 2×2 showcase grid. */
  feedGridImages: string[];
  /**
   * Background photo for the "Wallpaper Gallery" button (owner, 2026-08-09:
   * "the wallpaper button image upload is supposed to be in the landing page
   * section in the admin dashboard").
   *
   * It lives HERE rather than in the Wallpapers manager, which is where it was
   * first built. The owner is right and the reason is worth recording: this is
   * a landing-page image slot, and it belongs beside the other two — one place
   * an operator goes to change what the front page looks like, rather than a
   * landing setting hidden inside a library manager.
   *
   * Empty ⇒ the button falls back to its brand gradient, so the hero can never
   * render a broken image — the same fail-closed rule `reelsPosterUrl` follows.
   */
  wallpaperCtaImageUrl: string;
  /**
   * Whether Frenz AI is shown to SIGNED-OUT visitors.
   *
   * Owner, 2026-09-08: "put the frenz ai in the landing page and make it
   * anonymous and so google adsense crawler can see it and so it can be indexed
   * in google; for now make it configurable in admin dashboard where i can turn
   * off frenz ai from unsigned in users when adsense already approved".
   *
   * Default TRUE, because the reason it exists is to be crawlable right now. It
   * is a switch rather than a constant precisely so it can be turned off the
   * day it has done its job, without a deploy.
   *
   * 🔴 This governs VISIBILITY, never authority. Running a job still needs a
   * session: usage is counted per user id and a job is owned by one. A
   * signed-out visitor — or a crawler — sees the page and its real content and
   * is asked to sign in to use it.
   */
  frenzAiPublicEnabled: boolean;
  /**
   * Free AI Clean sessions per day.
   *
   * Owner, 2026-09-08: "make the free users usage credit to be 2 now because
   * there is no rewarded ad and it should be setable in admin dashboard."
   *
   * Admin-settable because the right number is a business decision that will
   * move — and it moves again in Part 10, when credits arrive. The authority is
   * still entirely server-side: this is read on the server, applied to the plan
   * policy, and enforced by the same atomic reservation as before.
   */
  frenzAiFreeDailyCredits: number;
  /**
   * Whether FREE members may run AI Clean at all.
   *
   * Owner, 2026-09-08: "since the replicate says credit first, then before the
   * reward ad start showing, set in admin dashboard so i can turn off anonymous
   * ai usage to show upgrade to pro and i can remove it later."
   *
   * 🔴 Distinct from setting the allowance to zero, and the difference is what a
   * member reads. Zero credits produces "you have used your 0 free cleans
   * today", which is nonsense. This switch produces "AI Clean is a Pro feature
   * right now" — which is the truth, and is the honest thing to say while every
   * job costs provider credit the owner is paying for directly.
   *
   * Paid plans are unaffected in both cases.
   */
  frenzAiFreeEnabled: boolean;
}

/** Nobody gets more than this from the admin field. A typo must not cost money. */
export const FRENZ_AI_MAX_FREE_CREDITS = 20;

export const DEFAULT_LANDING: LandingSettings = {
  reelsPosterUrl: "",
  feedGridImages: [],
  wallpaperCtaImageUrl: "",
  frenzAiPublicEnabled: true,
  // Two, because there is no rewarded ad to earn a third with yet.
  frenzAiFreeDailyCredits: 2,
  // ON by default: switching a feature off is a decision an operator makes, not
  // a state a fresh install falls into.
  frenzAiFreeEnabled: true,
};

/**
 * A free-credit value we are willing to act on.
 *
 * Clamped rather than trusted: this number becomes a daily allowance that costs
 * real provider money, and an admin field is still an input. A missing or
 * malformed value falls back to the default rather than to zero — locking every
 * free member out of the feature is a worse failure than one extra clean.
 */
export function normalizeFreeCredits(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LANDING.frenzAiFreeDailyCredits;
  return Math.max(0, Math.min(FRENZ_AI_MAX_FREE_CREDITS, Math.floor(n)));
}

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
      wallpaperCtaImageUrl: isAllowedImageUrl(raw.wallpaperCtaImageUrl) ? raw.wallpaperCtaImageUrl : "",
      // Absent means "not configured yet", which for a switch whose whole point
      // is present-day crawlability must mean ON.
      frenzAiPublicEnabled: raw.frenzAiPublicEnabled !== false,
      frenzAiFreeDailyCredits: normalizeFreeCredits(raw.frenzAiFreeDailyCredits),
      frenzAiFreeEnabled: raw.frenzAiFreeEnabled !== false,
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
    wallpaperCtaImageUrl: isAllowedImageUrl(s.wallpaperCtaImageUrl) ? s.wallpaperCtaImageUrl : "",
    // Normalised on the way IN as well as on the way out. An admin field that is
    // only validated on read is one bad write away from a stored value nothing
    // else in the system expects.
    frenzAiPublicEnabled: s.frenzAiPublicEnabled !== false,
    frenzAiFreeDailyCredits: normalizeFreeCredits(s.frenzAiFreeDailyCredits),
    frenzAiFreeEnabled: s.frenzAiFreeEnabled !== false,
  };
  await db.from("settings").upsert({ key: "landing", value }, { onConflict: "key" });
  cache = null;
}
