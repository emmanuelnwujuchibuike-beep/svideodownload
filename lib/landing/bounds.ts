/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LANDING / FRENZ AI BOUNDS A BROWSER MAY KNOW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure. No imports at all — so the admin forms can read a floor, a ceiling, a
 * currency symbol or a crop shape without pulling lib/landing/settings.ts into
 * a client bundle. That file imports the service-role Supabase client AND
 * builds its defaults from the Character Replace normaliser at module load, so
 * any VALUE imported from it drags the whole Character Replace configuration
 * (modes, voice, lip-sync, retention) into the eagerly-loaded /admin chunk.
 * That is exactly what tipped /admin over the route budget on 2026-09-14
 * (lib/perf/budget.test.ts) — 5 kB of config the panel does not even use.
 *
 * settings.ts re-exports every name here, so server code and the existing
 * tests keep importing from where they always did. Client components import
 * from THIS file. Same pattern, same reason, as lib/money/units.ts.
 */

/**
 * The currencies Paystack settles in, and the symbol each shows as.
 *
 * 🔴 Paystack's own supported set, not a wish list — a currency it cannot
 * process would be a transaction refused at checkout, in front of somebody
 * trying to pay us. The subunit is 100 for every one of these, which is why a
 * single "cents" integer works across all of them.
 */
export const AI_CURRENCIES = {
  USD: "$",
  NGN: "₦",
  GHS: "GH₵",
  ZAR: "R",
  KES: "KSh",
} as const;

export type AiCurrency = keyof typeof AI_CURRENCIES;

export function isAiCurrency(value: unknown): value is AiCurrency {
  return typeof value === "string" && value in AI_CURRENCIES;
}

export function aiCurrencySymbol(currency: AiCurrency): string {
  return AI_CURRENCIES[currency] ?? "$";
}

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

/** Nobody gets more than this from the admin field. A typo must not cost money. */
export const FRENZ_AI_MAX_FREE_CREDITS = 20;

/**
 * The bounds on a PAID daily cap.
 *
 * 🔴 A FLOOR as well as a ceiling, which the free field does not have and does
 * not need. Free may legitimately be zero — that is a business decision an
 * operator makes deliberately. Paid may not: somebody is paying for this, so a
 * mistyped `1` must not silently become a breach of what they bought. One is
 * the number a slipped keystroke produces; the floor is what stops it landing.
 *
 * The ceiling is a spend control. Every AI job costs real provider money, so a
 * value with an extra digit in it is a bill nobody approved, arriving as a
 * surprise a month later.
 */
/**
 * ── 🔴 ONE. IT WAS THREE, AND THREE WAS MY RULE RATHER THAN THE OWNER'S ─────
 *
 * Owner, 2026-09-09: "i tried setting the limit for pro daily to 2 and business
 * to 5 but it showed number must be equal to, and the button to set the weekly
 * limit."
 *
 * The floor was 3, reasoned as "a paid plan may never give less than the free
 * one, which gives 2". That is a product opinion I invented and then enforced
 * against the person whose product it is — and it contradicts the standing
 * Frenz AI rule the owner wrote themselves: "Pro users do NOT get unlimited AI.
 * Business users do NOT get unlimited AI." A subscription buys no AI in this
 * system, so a Pro daily allowance EQUAL to the free one is not a mistake, it
 * is that rule applied exactly.
 *
 * ⚠️ It also cost more than the field it guarded. The admin panel saves every
 * AI setting in ONE request, so a Pro value of 2 failed the schema and took the
 * whole payload with it — the weekly allowance, the price, the currency and the
 * minimum deposit all silently refused to save because of an unrelated field.
 * That is the second half of the owner's sentence.
 *
 * One, not zero, because zero already means something else everywhere in this
 * system: `normalizePaidCredits` and `applyConfiguredLimits` both read 0 as
 * "not configured" and fall through to the shipped policy. A floor of 1 keeps
 * that single meaning intact while letting the operator set any real number.
 */
export const FRENZ_AI_MIN_PAID_CREDITS = 1;

/**
 * Bounds on the WEEKLY free allowance.
 *
 * 🔴 Zero IS allowed, unlike the paid floor: an operator switching the weekly
 * allowance to 0 is saying "no free AI this week", which is a real business
 * decision and the same one `frenzAiFreeDailyCredits: 0` expresses for a day.
 * The ceiling is a spend control — every free job costs the same provider money
 * a paid one does, it is simply billed to us.
 */
export const FRENZ_AI_MAX_WEEKLY_CREDITS = 200;

/**
 * Bounds on the price of one AI video, in CENTS.
 *
 * ── 🔴 A FLOOR OF 1, NOT 0 ──────────────────────────────────────────────────
 *
 * A price of zero would make every paid job free — which sounds harmless and is
 * the most expensive possible misconfiguration: the free allowance would still
 * run out, the member would still be sent to the paid path, and every job past
 * that point would run at our cost with a $0.00 ledger entry recording it.
 * Turning paid usage off is not a price of zero; it is switching the feature
 * off, which is a different control.
 *
 * ⚠️ The ceiling is $100 a video. Not because anybody would set it, but because
 * a slipped digit on a field measured in CENTS is two orders of magnitude — an
 * operator typing "50" meaning dollars would otherwise charge $50 per clean.
 */
export const FRENZ_AI_MIN_PRICE_CENTS = 1;
/**
 * ── 🔴 RAISED 10,000 → 1,000,000 (2026-09-09) ───────────────────────────────
 *
 * Owner: "i set 500 naira per video and 2000 naira minimum deposit and is
 * showing 50 naira, i dont really understand."
 *
 * Two bugs met here and this is the second. The ceiling was 10,000 MINOR units
 * and I reasoned about it in dollars — "$100 a video, nobody would set that".
 * In naira 10,000 kobo is ₦100, so the owner's entirely ordinary ₦500 price
 * (50,000 kobo) was ABOVE the maximum and the save was refused outright.
 *
 * A bound expressed in minor units cannot carry a judgement about VALUE unless
 * it also knows the currency, and this one did not. 1,000,000 minor units is
 * ₦10,000 or $10,000 — generous enough that no real currency's sensible price
 * is excluded, tight enough to still catch a slipped digit now that the field
 * is entered in major units and a typo moves the number by 10x rather than
 * 100x.
 */
export const FRENZ_AI_MAX_PRICE_CENTS = 1_000_000;

/**
 * Bounds on the smallest top-up.
 *
 * ── 🔴 THE FLOOR IS ABOUT PAYMENT FEES, NOT ABOUT US ────────────────────────
 *
 * 100 minor units — $1.00, or ₦100. Below that a card processor's own
 * per-transaction fee is a large fraction of the sale, so a 20-cent top-up
 * costs more to collect than it collects. Refusing it is kinder than taking it.
 *
 * The ceiling is on the MINIMUM, not on what somebody may deposit: the ladder
 * multiplies this by ten, so a minimum of 100,000 already offers a top of
 * 1,000,000 minor units. A slipped digit here would otherwise put a five-figure
 * charge in front of a member as the smallest option available.
 */
export const FRENZ_AI_MIN_TOPUP_FLOOR = 100;
/**
 * 🔴 RAISED 100,000 → 10,000,000 for the same reason as the price ceiling: in
 * naira the old value was ₦1,000, so the owner's ₦2,000 minimum deposit was
 * refused. The ladder multiplies this by ten, so a minimum at this ceiling
 * still offers a top option a real currency can express.
 */
export const FRENZ_AI_MIN_TOPUP_CEILING = 10_000_000;

export const FRENZ_AI_MAX_PAID_CREDITS = 500;

/*
  The money-unit helpers live in lib/money/units.ts (2026-09-13) for the same
  reason this file exists; re-exported so a form needs one import.
*/
export { MINOR_UNITS_PER_MAJOR, majorInputToMinor, minorToMajorInput } from "@/lib/money/units";
