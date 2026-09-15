import { recordConfigChange } from "@/lib/platform/config-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeCharacterReplaceConfig,
  versionCharacterReplacePricing,
  type CharacterReplaceConfig,
} from "@/lib/ai/character-replace/config";

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

/*
  The bounds, currencies and crop shapes a BROWSER may know moved to
  lib/landing/bounds.ts on 2026-09-14 — this file imports the service-role
  client and builds its defaults from the Character Replace normaliser at load,
  so importing any value from it pulled the whole Character Replace config into
  the eager /admin chunk and over the route budget. Re-exported so server code
  and the tests that import them from here keep working unchanged.
*/
export {
  AI_CURRENCIES,
  isAiCurrency,
  aiCurrencySymbol,
  LANDING_IMAGE_ASPECT,
  FRENZ_AI_MAX_FREE_CREDITS,
  FRENZ_AI_MIN_PAID_CREDITS,
  FRENZ_AI_MAX_WEEKLY_CREDITS,
  FRENZ_AI_MIN_PRICE_CENTS,
  FRENZ_AI_MAX_PRICE_CENTS,
  FRENZ_AI_MIN_TOPUP_FLOOR,
  FRENZ_AI_MIN_TOPUP_CEILING,
  FRENZ_AI_MAX_PAID_CREDITS,
  MINOR_UNITS_PER_MAJOR,
  majorInputToMinor,
  minorToMajorInput,
} from "@/lib/landing/bounds";
export type { AiCurrency } from "@/lib/landing/bounds";
import {
  isAiCurrency,
  FRENZ_AI_MAX_FREE_CREDITS,
  FRENZ_AI_MIN_PAID_CREDITS,
  FRENZ_AI_MAX_WEEKLY_CREDITS,
  FRENZ_AI_MIN_PRICE_CENTS,
  FRENZ_AI_MAX_PRICE_CENTS,
  FRENZ_AI_MIN_TOPUP_FLOOR,
  FRENZ_AI_MIN_TOPUP_CEILING,
  FRENZ_AI_MAX_PAID_CREDITS,
  type AiCurrency,
} from "@/lib/landing/bounds";

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
   * ── 🔴 THE PAID DAILY CAPS, NOW OPERATOR-SETTABLE TOO ─────────────────────
   *
   * Owner, 2026-09-09: "pro and business cap should be able to change in admin
   * dashboard, if is not set yet set it up."
   *
   * Only the free tier was configurable, and `applyConfiguredLimits` carried a
   * written argument for keeping it that way: "an operator lowering Pro to
   * 1/day by mistake would be a silent breach of a subscription, and raising
   * Business to 500 would be a provider bill nobody approved."
   *
   * That argument was about the RISK of the field, not about who should decide,
   * and the owner has answered the second question. So the field exists and the
   * risk is answered where risk belongs — in the bounds:
   *
   *   · a FLOOR, so a mistyped value cannot take a paying member below what
   *     the plan is sold with (`FRENZ_AI_MIN_PAID_CREDITS`);
   *   · a CEILING, so a slipped digit cannot commit to a provider bill nobody
   *     approved (`FRENZ_AI_MAX_PAID_CREDITS`);
   *   · and a malformed value falls back to the shipped default rather than to
   *     zero — locking a subscriber out is the worst of the failures available.
   *
   * 0 is NOT a way to switch a paid tier off. There is no product in which a
   * paying member has no allowance, so the floor refuses it; turning the
   * feature off for everybody is `frenzAiFreeEnabled`'s job and a different
   * decision.
   *
   * 🔴 Max AI is deliberately absent. That plan does not exist yet — its
   * policy row is a placeholder — and an admin field for a tier nobody can buy
   * is a control that cannot be verified against anything.
   */
  frenzAiProDailyCredits: number;
  frenzAiBusinessDailyCredits: number;
  /**
   * ── 🔴 THE WEEKLY FREE ALLOWANCE ──────────────────────────────────────────
   *
   * Owner, 2026-09-09 (standing Frenz AI rule, §6/§7): "There are two separate
   * limits… A user cannot bypass the weekly limit by waiting for the daily
   * counter to reset."
   *
   * Both ceilings apply and the LOWER remaining one wins. Daily alone was
   * gameable by patience: 2 a day is 14 a week, and the point of a weekly floor
   * is that it is not.
   *
   * The reset boundary is documented once, in `lib/ai/economy.ts`, and every
   * reader of this number must use that definition — a week that means
   * "rolling 7 days" in one place and "since Monday" in another is two
   * different products.
   */
  frenzAiWeeklyFreeCredits: number;
  /**
   * ── 🔴 WHAT ONE AI VIDEO COSTS, IN CENTS ──────────────────────────────────
   *
   * Owner, 2026-09-09: "make the price per video be adjustable from the admin
   * dashboard", and from the standing rule: "This should be represented as a
   * configurable server-side value rather than hard-coded throughout the
   * frontend."
   *
   * 🔴 CENTS, AS AN INTEGER. Never a float, and never dollars. `0.1 + 0.2` is
   * not `0.3` in binary floating point, and a balance that drifts by fractions
   * of a cent per transaction is a ledger that stops reconciling — which is the
   * one thing a ledger exists to do. Every amount in this system is an integer
   * number of cents from the database to the button, and dollars exist only in
   * the final formatting step.
   *
   * 50 = $0.50, the price the owner set.
   */
  frenzAiVideoPriceCents: number;
  /**
   * ── 🔴 WHICH CURRENCY THOSE "CENTS" ARE ─────────────────────────────────
   *
   * Paystack amounts are in the SUBUNIT of the account's currency, and the API
   * does not tell you which one it assumed. Sending `500` to an NGN account
   * charges ₦5.00; to a USD account it charges $5.00. Those differ by about a
   * factor of 1,500, and nothing in the response says which happened.
   *
   * So the currency is stated here and passed EXPLICITLY on every transaction.
   * If it does not match what the Paystack account supports, Paystack refuses
   * the transaction — which is loud, immediate, and enormously better than
   * silently taking ₦5 for something priced at $5.
   *
   * ⚠️ MUST match the operator's Paystack account. There is no way to detect it
   * from our side, so this is a setting rather than a guess, and the admin
   * field says so.
   */
  frenzAiCurrency: AiCurrency;
  /**
   * ── 🔴 THE SMALLEST TOP-UP, IN MINOR UNITS OF `frenzAiCurrency` ─────────
   *
   * Owner, 2026-09-09: "whats the minimum deposit? it should be configurable
   * from admin dashboard."
   *
   * The offered amounts are this times 1, 2, 5 and 10 — see `aiTopupOptions`.
   * One setting rather than four so the ladder is always ordered and always
   * starts where the operator said.
   *
   * ⚠️ It is in the SAME units as `frenzAiVideoPriceCents`, so its sensible
   * value moves with the currency: 500 is $5.00 on a USD account and ₦5.00 on
   * a naira one, and the second is not a deposit anybody would make. The admin
   * field renders the configured symbol beside it for exactly this reason.
   */
  frenzAiMinTopupCents: number;
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
  /**
   * The background photo on the Frenz AI tile (landing + downloads).
   *
   * Owner, 2026-09-08: "the ai button should be this image", with a cyberpunk
   * AI-eye render attached. An image that specific has to be uploadable rather
   * than committed — it is art direction, it will change, and it should not
   * need a deploy or me. Empty falls back to the drawn circuitry backdrop, so
   * the tile is never broken while the slot is empty.
   */
  frenzAiTileImageUrl: string;
  /**
   * Which engine reconstructs the background behind removed text.
   *
   * Owner, 2026-09-09: "i dont see a switch in admin dashboard to switch the
   * propainter off or on."
   *
   * Fair — it shipped as an environment variable, which means a deploy and me.
   *
   *   classical    hjunior29 detects AND fills. One CPU call. Fast, cheap, and
   *                it SMEARS: measured on 2026-09-09, all three of its fill
   *                algorithms produced the same washed-out band, including at
   *                `margin: 0`. Its fills are single-frame diffusion and cannot
   *                know what is behind the text.
   *   propainter   hjunior29 detects only; ProPainter reconstructs temporally
   *                from frames where the region was NOT covered. Substantially
   *                cleaner — no rectangular edge — at the cost of a GPU call on
   *                top of the CPU one and roughly 210s of inference.
   *
   * ⚠️ Defaults to `classical`, because the expensive one should be a decision
   * somebody makes rather than a state a fresh install falls into. It also has a
   * real weakness: a caption that never moves over a background that never moves
   * gives a temporal model nothing to borrow from, and it hallucinates.
   */
  frenzAiEngine: AiCleanEngineSetting;
  /**
   * ── CHARACTER REPLACE, AS ONE OBJECT (2026-09-13, Part 1 §15) ─────────────
   *
   * The whole tool's operator configuration — on/off, the qualities and their
   * multipliers, the rate per second, the minimum, the lip-sync tiers and
   * their prices, the languages, the ceilings, the trim rules — nested under
   * ONE key rather than spread across a dozen flat fields. The type and its
   * normaliser live with the tool (lib/ai/character-replace/config.ts); this
   * row only stores and returns it. Adding a knob is one field there, and
   * nothing here changes.
   *
   * ⚠️ Normalised on the way in AND on the way out, like every other field:
   * several of these values become money.
   */
  frenzAiCharacterReplace: CharacterReplaceConfig;
}

/** The two engines, as a value the settings row can hold. */
export type AiCleanEngineSetting = "classical" | "propainter";

export const DEFAULT_LANDING: LandingSettings = {
  reelsPosterUrl: "",
  feedGridImages: [],
  wallpaperCtaImageUrl: "",
  frenzAiPublicEnabled: true,
  // Two, because there is no rewarded ad to earn a third with yet.
  frenzAiFreeDailyCredits: 2,
  /*
    ── 🔴 THESE MATCH `AI_CLEAN`, NOT `DEFAULT_BY_AUDIENCE` ──────────────────

    lib/ai/policy.ts has TWO tables. `DEFAULT_BY_AUDIENCE` is the fallback for a
    feature with no policy of its own (pro 10, business 25); `AI_CLEAN` is the
    one that actually applies here (pro 5, business 15), and `policyFor` prefers
    it. I wrote the fallback's numbers in first and the entitlement tests caught
    it immediately — an operator opening the admin form would have seen 10 and
    25 for a feature that gives 5 and 15, and saving without editing would have
    DOUBLED both allowances by accident.

    A test pins these to `AI_CLEAN` so the two files cannot drift apart again.
  */
  frenzAiProDailyCredits: 5,
  frenzAiBusinessDailyCredits: 15,
  /*
    Five a week against two a day: a member who cleans on three days uses the
    week, which is the shape the owner described (2 + 2 + 1). The numbers are
    the ones named in the spec and both are operator-settable, so neither is a
    commitment this file makes on its own.
  */
  frenzAiWeeklyFreeCredits: 5,
  // $0.50, in cents. See the field note on why this is never a float.
  frenzAiVideoPriceCents: 50,
  /*
    🔴 USD by default, and the operator MUST set this to match their Paystack
    account. We cannot detect it, and getting it wrong means charging ₦50 for
    something priced at $0.50 — or the reverse.
  */
  frenzAiCurrency: "USD" as AiCurrency,
  // $5.00 at the default currency. An operator on naira must raise this.
  frenzAiMinTopupCents: 500,
  // ON by default: switching a feature off is a decision an operator makes, not
  // a state a fresh install falls into.
  frenzAiFreeEnabled: true,
  // Empty: the tile draws its own backdrop until an image is uploaded.
  frenzAiTileImageUrl: "",
  // The cheap one. Turning on the GPU engine costs money per job and is the
  // operator’s call.
  frenzAiEngine: "classical",
  // The tool's own defaults — see lib/ai/character-replace/config.ts.
  frenzAiCharacterReplace: normalizeCharacterReplaceConfig(null),
};

/** Anything that is not exactly "propainter" is the safe, cheap engine. */
export function normalizeEngine(value: unknown): AiCleanEngineSetting {
  return value === "propainter" ? "propainter" : "classical";
}

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

export function normalizeWeeklyCredits(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_LANDING.frenzAiWeeklyFreeCredits;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LANDING.frenzAiWeeklyFreeCredits;
  return Math.max(0, Math.min(FRENZ_AI_MAX_WEEKLY_CREDITS, Math.floor(n)));
}

export function normalizeMinTopup(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_LANDING.frenzAiMinTopupCents;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LANDING.frenzAiMinTopupCents;
  return Math.max(FRENZ_AI_MIN_TOPUP_FLOOR, Math.min(FRENZ_AI_MIN_TOPUP_CEILING, Math.floor(n)));
}

export function normalizePriceCents(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_LANDING.frenzAiVideoPriceCents;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LANDING.frenzAiVideoPriceCents;
  return Math.max(FRENZ_AI_MIN_PRICE_CENTS, Math.min(FRENZ_AI_MAX_PRICE_CENTS, Math.floor(n)));
}

/**
 * A paid-credit value we are willing to act on.
 *
 * Clamped and defaulted exactly like the free one, and for the stronger reason:
 * a malformed value here would take an allowance away from somebody who paid
 * for it, so it falls back to the shipped default rather than to the floor.
 */
export function normalizePaidCredits(
  value: unknown,
  fallback: number,
): number {
  /*
    ── 🔴 ABSENT IS NOT ZERO, AND JAVASCRIPT DISAGREES ───────────────────────

    `Number(null)`, `Number("")` and `Number([])` are all 0 — finite, and
    therefore indistinguishable from a deliberate zero to the `isFinite` check
    alone. Every one of those is what "the operator did not fill this in"
    actually looks like coming out of a form or a JSON column, and clamping them
    to the floor would silently rewrite an unset field into a real setting.

    Zero is folded in with them rather than clamped, because for a PAID cap
    there is no product in which zero is a choice — the floor already forbids
    it. Switching the feature off is `frenzAiFreeEnabled`'s job.

    🔴 Note this is the OPPOSITE rule to `normalizeFreeCredits`, deliberately.
    Zero free credits is a legitimate business decision an operator makes on
    purpose; zero paid credits is always a mistake.
  */
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(FRENZ_AI_MIN_PAID_CREDITS, Math.min(FRENZ_AI_MAX_PAID_CREDITS, Math.floor(n)));
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
      frenzAiProDailyCredits: normalizePaidCredits(
        raw.frenzAiProDailyCredits,
        DEFAULT_LANDING.frenzAiProDailyCredits,
      ),
      frenzAiBusinessDailyCredits: normalizePaidCredits(
        raw.frenzAiBusinessDailyCredits,
        DEFAULT_LANDING.frenzAiBusinessDailyCredits,
      ),
      frenzAiWeeklyFreeCredits: normalizeWeeklyCredits(raw.frenzAiWeeklyFreeCredits),
      frenzAiVideoPriceCents: normalizePriceCents(raw.frenzAiVideoPriceCents),
      frenzAiCurrency: isAiCurrency(raw.frenzAiCurrency) ? raw.frenzAiCurrency : DEFAULT_LANDING.frenzAiCurrency,
      frenzAiMinTopupCents: normalizeMinTopup(raw.frenzAiMinTopupCents),
      frenzAiFreeEnabled: raw.frenzAiFreeEnabled !== false,
      frenzAiEngine: normalizeEngine(raw.frenzAiEngine),
      frenzAiTileImageUrl: isAllowedImageUrl(raw.frenzAiTileImageUrl) ? raw.frenzAiTileImageUrl : "",
      frenzAiCharacterReplace: normalizeCharacterReplaceConfig(raw.frenzAiCharacterReplace),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return DEFAULT_LANDING;
  }
}

/** Admin: persist the landing image slots. */
/**
 * Write landing settings, MERGING with what is already stored.
 *
 * ── 🔴 IT USED TO REPLACE, AND THAT WAS SILENT DATA LOSS ────────────────────
 *
 * Found 2026-09-08. `features/admin/landing-editor.tsx` POSTs exactly two
 * fields — the reels poster and the wallpaper image — while the route's zod
 * schema gives every other field a `.default()`. So each time an operator
 * pressed Save on that panel:
 *
 *     feedGridImages           -> []      the 2x2 grid images WIPED
 *     frenzAiPublicEnabled     -> true    reset
 *     frenzAiFreeDailyCredits  -> 2       reset
 *     frenzAiFreeEnabled       -> true    reset
 *
 * Nothing reported it, and the panel that caused it does not display any of
 * those values, so an operator could not have seen it happen. This is the exact
 * trap already written down for `MonetizationSettings` — "that object is
 * written wholesale from one big admin form, so a field there would be reset to
 * its zod default every time an operator saved the panel".
 *
 * A partial update now leaves everything it does not mention alone, so adding a
 * field to this object can never again be a way to lose a different one. The
 * caller sends what it edited; nothing else moves.
 */
/**
 * What a caller may send: any flat field, and for the nested Character Replace
 * object a PARTIAL of it — the admin panel posts only the knobs it shows.
 */
export type LandingSettingsPatch = Partial<Omit<LandingSettings, "frenzAiCharacterReplace">> & {
  frenzAiCharacterReplace?: Record<string, unknown>;
};

/**
 * The Character Replace patch is merged ONE LEVEL DEEPER than a spread for
 * its nested objects (Part 6): a panel that posts `modes: { face_only: {…} }`
 * must not erase `skin_face`, and `audio: { syncMode }` must not erase the
 * audio ceilings. Arrays (qualities, tiers, voices…) are still replaced
 * wholesale — the normaliser merges those by id over the defaults.
 */
function mergeCharacterReplacePatch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && existing && typeof existing === "object" && !Array.isArray(existing)) {
      out[key] = mergeCharacterReplacePatch(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function setLandingSettings(s: LandingSettingsPatch, audit: { changedBy?: string | null; reason?: string | null } = {}): Promise<void> {
  const db = createAdminClient();
  const current = await getLandingSettings();

  const pick = <K extends Exclude<keyof LandingSettings, "frenzAiCharacterReplace">>(key: K): LandingSettings[K] =>
    s[key] === undefined ? current[key] : (s[key] as unknown as LandingSettings[K]);

  const value: LandingSettings = {
    reelsPosterUrl: isAllowedImageUrl(pick("reelsPosterUrl")) ? pick("reelsPosterUrl") : "",
    feedGridImages: normalizeFeedGridImages(pick("feedGridImages")),
    wallpaperCtaImageUrl: isAllowedImageUrl(pick("wallpaperCtaImageUrl"))
      ? pick("wallpaperCtaImageUrl")
      : "",
    // Normalised on the way IN as well as on the way out. An admin field that is
    // only validated on read is one bad write away from a stored value nothing
    // else in the system expects.
    frenzAiPublicEnabled: pick("frenzAiPublicEnabled") !== false,
    frenzAiFreeDailyCredits: normalizeFreeCredits(pick("frenzAiFreeDailyCredits")),
    // Same discipline as the free one, with the paid bounds. `pick` returns the
    // CURRENT value when the caller did not send the field, so a panel that
    // edits one cap can never reset the other.
    frenzAiProDailyCredits: normalizePaidCredits(
      pick("frenzAiProDailyCredits"),
      DEFAULT_LANDING.frenzAiProDailyCredits,
    ),
    frenzAiBusinessDailyCredits: normalizePaidCredits(
      pick("frenzAiBusinessDailyCredits"),
      DEFAULT_LANDING.frenzAiBusinessDailyCredits,
    ),
    frenzAiWeeklyFreeCredits: normalizeWeeklyCredits(pick("frenzAiWeeklyFreeCredits")),
    frenzAiVideoPriceCents: normalizePriceCents(pick("frenzAiVideoPriceCents")),
    frenzAiCurrency: isAiCurrency(pick("frenzAiCurrency")) ? pick("frenzAiCurrency") : DEFAULT_LANDING.frenzAiCurrency,
    frenzAiMinTopupCents: normalizeMinTopup(pick("frenzAiMinTopupCents")),
    frenzAiFreeEnabled: pick("frenzAiFreeEnabled") !== false,
    frenzAiEngine: normalizeEngine(pick("frenzAiEngine")),
    frenzAiTileImageUrl: isAllowedImageUrl(pick("frenzAiTileImageUrl")) ? pick("frenzAiTileImageUrl") : "",
    /*
      The nested object is MERGED, not replaced: a panel that posts only
      `{ enabled: false }` keeps every rate the operator already typed. The
      normaliser then clamps the merged result, so a partial write can never
      leave a field the reader would refuse.
    */
    frenzAiCharacterReplace: versionCharacterReplacePricing(
      current.frenzAiCharacterReplace,
      normalizeCharacterReplaceConfig(mergeCharacterReplacePatch(current.frenzAiCharacterReplace as unknown as Record<string, unknown>, (s.frenzAiCharacterReplace ?? {}) as Record<string, unknown>)),
      // Part 6 §27: who changed the prices and why, recorded with the superseded version.
      audit,
    ),
  };
  await db.from("settings").upsert({ key: "landing", value }, { onConflict: "key" });
  cache = null;

  /*
    ── Part 8 §22: THE ADMIN AUDIT LOG ──────────────────────────────────────
    Every Character Replace settings change is written to config_audit_log
    (the platform's existing governance table) as the keys that CHANGED —
    before and after — with the admin's id and their reason. The pricing
    history above keeps the full price snapshots per version; this is the
    line-by-line record of switches, limits, models and retention too.
    Best-effort and after the save: an audit that could refuse the change it
    records would be a switch the operator cannot flip in an emergency.
  */
  if (s.frenzAiCharacterReplace) {
    const beforeCr = current.frenzAiCharacterReplace as unknown as Record<string, unknown>;
    const afterCr = value.frenzAiCharacterReplace as unknown as Record<string, unknown>;
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const key of Object.keys(afterCr)) {
      if (key === "pricingHistory" || key === "pricingUpdatedAt" || key === "pricingVersion") continue;
      if (JSON.stringify(beforeCr[key]) !== JSON.stringify(afterCr[key])) {
        changedBefore[key] = beforeCr[key];
        changedAfter[key] = afterCr[key];
      }
    }
    if (Object.keys(changedAfter).length > 0) {
      recordConfigChange({
        actorId: audit.changedBy ?? null,
        surface: "character_replace",
        targetId: "settings",
        action: "settings.update",
        before: changedBefore,
        after: { ...changedAfter, ...(audit.reason ? { _reason: audit.reason } : {}) },
      });
    }
  }
}

