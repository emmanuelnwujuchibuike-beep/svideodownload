import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import {
  FEED_GRID_SLOTS,
  FRENZ_AI_MAX_FREE_CREDITS,
  FRENZ_AI_MAX_PAID_CREDITS,
  FRENZ_AI_MAX_PRICE_CENTS,
  FRENZ_AI_MAX_WEEKLY_CREDITS,
  FRENZ_AI_MIN_PRICE_CENTS,
  FRENZ_AI_MIN_TOPUP_CEILING,
  FRENZ_AI_MIN_TOPUP_FLOOR,
  FRENZ_AI_MIN_PAID_CREDITS,
  setLandingSettings,
} from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Each image is either a root-relative asset (/brand/…) or an absolute https URL —
  the shape `ImageUpload` returns from Supabase Storage's public URL. No data: URIs
  and no http:, matching `isAllowedImageUrl` in lib/landing/settings.ts; the store
  re-validates too, so a bad value can never reach the public page.
*/
const isAssetOrHttps = (v: string) => v.startsWith("/") || v.startsWith("https://");

/** A non-empty grid image: a site asset path or an absolute https URL. */
const gridImage = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isAssetOrHttps, { message: "Image must be an https URL or a site asset path." });

/** The reels poster: same shape, but "" (cleared) is allowed. */
const reelsPoster = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || isAssetOrHttps(v), {
    message: "Image must be an https URL or a site asset path.",
  });

/*
  🔴 EVERY FIELD IS OPTIONAL, AND THAT IS THE FIX.

  These carried `.default()`, and the Landing panel POSTs only two of them —
  so every save reset the feed-grid images to [] and all three Frenz AI
  settings to their defaults, silently, on a screen that does not even show
  them. `setLandingSettings` now merges, and a field that was not sent must
  therefore arrive as `undefined` rather than as a manufactured default.

  A default here is indistinguishable from an operator's deliberate choice by
  the time it reaches the store. Optional is the only shape that can tell
  "leave it alone" apart from "set it to this".
*/
const schema = z.object({
  reelsPosterUrl: reelsPoster.optional(),
  feedGridImages: z.array(gridImage).max(FEED_GRID_SLOTS).optional(),
  // Same shape and same clearable rule as the reels poster.
  wallpaperCtaImageUrl: reelsPoster.optional(),
  /*
    Frenz AI operator switches (owner, 2026-09-08).

    `frenzAiPublicEnabled` decides whether signed-out visitors — and the AdSense
    crawler — see Frenz AI at all; it defaults ON because being crawlable now is
    the reason it exists, and the owner turns it off once AdSense has approved.

    `frenzAiFreeDailyCredits` is the free allowance. Bounded HERE as well as in
    `setLandingSettings`: a number that becomes a daily allowance costs real
    provider money, and one validation is one thing to forget.
  */
  frenzAiPublicEnabled: z.boolean().optional(),
  frenzAiFreeDailyCredits: z.coerce.number().int().min(0).max(FRENZ_AI_MAX_FREE_CREDITS).optional(),
  /*
    The paid caps (owner, 2026-09-09: "pro and business cap should be able to
    change in admin dashboard").

    🔴 A FLOOR as well as a ceiling, which the free field above does not have.
    Free may legitimately be 0 — that is a deliberate business decision. Paid
    may not: somebody is paying for this, so a mistyped `1` must be REFUSED by
    the schema rather than clamped silently, and the operator told. The floor is
    what stops a slipped keystroke becoming a quiet breach of a subscription.

    Bounded here AND in `normalizePaidCredits`, for the same reason the free
    field is: one validation is one thing to forget.
  */
  frenzAiProDailyCredits: z.coerce
    .number()
    .int()
    .min(FRENZ_AI_MIN_PAID_CREDITS)
    .max(FRENZ_AI_MAX_PAID_CREDITS)
    .optional(),
  frenzAiBusinessDailyCredits: z.coerce
    .number()
    .int()
    .min(FRENZ_AI_MIN_PAID_CREDITS)
    .max(FRENZ_AI_MAX_PAID_CREDITS)
    .optional(),
  /*
    The WEEKLY free allowance (owner, 2026-09-09, standing rule §6/§7). Zero is
    allowed here and not on the paid caps: "no free AI this week" is a real
    decision, where "a paid plan gives less than free" is a typo.
  */
  frenzAiWeeklyFreeCredits: z.coerce.number().int().min(0).max(FRENZ_AI_MAX_WEEKLY_CREDITS).optional(),
  /*
    🔴 THE PRICE OF ONE AI VIDEO, IN CENTS (owner: "make the price per video be
    adjustable from the admin dashboard").

    Integer cents, never dollars and never a float — see the field note in
    lib/landing/settings.ts. The floor is 1 rather than 0 because a price of
    zero is the most expensive misconfiguration available: the free allowance
    still runs out, the member is still routed to the paid path, and every job
    after that runs at our cost with a $0.00 ledger entry recording it.
  */
  frenzAiVideoPriceCents: z.coerce
    .number()
    .int()
    .min(FRENZ_AI_MIN_PRICE_CENTS)
    .max(FRENZ_AI_MAX_PRICE_CENTS)
    .optional(),
  /*
    🔴 The billing CURRENCY. An enum, not a string: this value is sent to
    Paystack on every transaction, and a typo would be a refused checkout in
    front of somebody trying to pay.
  */
  frenzAiCurrency: z.enum(["USD", "NGN", "GHS", "ZAR", "KES"]).optional(),
  /* The smallest deposit, in the same minor units as the price above. */
  frenzAiMinTopupCents: z.coerce
    .number()
    .int()
    .min(FRENZ_AI_MIN_TOPUP_FLOOR)
    .max(FRENZ_AI_MIN_TOPUP_CEILING)
    .optional(),
  /*
    Turn the free tier off entirely and show "Pro feature" instead. Kept
    separate from a zero credit count so the interface can say the right thing;
    see the field's note in lib/landing/settings.ts.
  */
  frenzAiFreeEnabled: z.boolean().optional(),
  // Same shape and same clearable rule as the other image slots.
  frenzAiTileImageUrl: reelsPoster.optional(),
  /*
    🔴 An ENUM, not a free string. This value selects which provider spends
    money on the next job, so the only two things it may ever be are named here
    — a typo must fall back to the cheap engine, not to something undefined.

    And it must be in this schema at all: a field the panel POSTs that the route
    does not validate is stripped silently, which is how an admin switch ends up
    controlling nothing. This codebase has had six of those.
  */
  frenzAiEngine: z.enum(["classical", "propainter"]).optional(),
  /*
    ── CHARACTER REPLACE (2026-09-13, Part 1 §15) ──────────────────────────────

    The tool's configuration travels as ONE nested object. The shape is
    validated loosely here — the keys the panel may send, each optional — and
    then clamped by the tool's own normaliser inside `setLandingSettings`,
    which is the single authority on bounds (lib/ai/character-replace/config.ts).
    Two validators with two sets of bounds would drift; this one only refuses
    the wrong TYPE so the operator gets a field name back.
  */
  frenzAiCharacterReplace: z
    .object({
      enabled: z.boolean().optional(),
      pricePerSecondCents: z.number().int().min(0).max(10_000_000).optional(),
      basePriceCents: z.number().int().min(0).max(100_000_000).optional(),
      minimumChargeCents: z.number().int().min(0).max(100_000_000).optional(),
      maximumDurationSeconds: z.number().int().min(1).max(120).optional(),
      maximumUploadBytes: z.number().int().min(1024 * 1024).optional(),
      maximumPixels: z.number().int().min(640 * 360).optional(),
      qualities: z
        .array(
          z.object({
            id: z.enum(["480p", "720p", "1080p"]),
            label: z.string().max(12).optional(),
            hint: z.string().max(24).optional(),
            multiplier: z.number().min(0.05).max(20).optional(),
            perSecondCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
            enabled: z.boolean().optional(),
          }),
        )
        .max(3)
        .optional(),
      lipSyncEnabled: z.boolean().optional(),
      lipSync: z
        .array(
          z.object({
            id: z.enum(["standard", "studio"]),
            label: z.string().max(20).optional(),
            blurb: z.string().max(120).optional(),
            perSecondCents: z.number().int().min(0).max(1_000_000).optional(),
            enabled: z.boolean().optional(),
          }),
        )
        .max(2)
        .optional(),
      languages: z
        .array(z.object({ code: z.string().max(40), label: z.string().max(40), native: z.string().max(40).optional() }))
        .max(60)
        .optional(),
      voices: z
        .array(
          z.object({
            id: z.string().max(40),
            label: z.string().max(40),
            blurb: z.string().max(80).optional(),
            languages: z.array(z.string().max(40)).max(60).optional(),
          }),
        )
        .max(40)
        .optional(),
      trim: z.object({ enabled: z.boolean().optional(), minimumSeconds: z.number().min(0.5).max(30).optional() }).optional(),
      voice: z
        .object({ newVoiceEnabled: z.boolean().optional(), surchargePerSecondCents: z.number().int().min(0).max(100_000_000).optional() })
        .optional(),
      recharge: z
        .object({
          minCents: z.number().int().min(100).max(1_000_000_000).optional(),
          maxCents: z.number().int().min(100).max(10_000_000_000).optional(),
          packages: z
            .array(z.object({ amountCents: z.number().int().positive(), enabled: z.boolean().optional(), order: z.number().int().min(0).optional() }))
            .max(12)
            .optional(),
        })
        .optional(),
      /*
        🔴 NOT accepted from a panel: `pricingVersion`, `pricingUpdatedAt`,
        `pricingHistory`. The server stamps them (settings.ts); a body that
        carries them is refused by `.strict()`.
      */
    })
    .strict()
    .optional(),
});

/** Admin-only: set the landing page's reels poster and 2×2 feed-grid images. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    /*
      ── 🔴 SAY WHICH FIELD, BECAUSE THIS PANEL SAVES ALL OF THEM AT ONCE ────

      Owner, 2026-09-09: "i tried setting the limit for pro daily to 2 and
      business to 5 but it showed number must be equal to, and the button to
      set the weekly limit."

      One out-of-range number refused the ENTIRE payload — the weekly
      allowance, the price, the currency and the minimum deposit along with it
      — and the message said only "Invalid settings payload", so from the
      operator's side the weekly limit simply would not save. Naming the field
      is the difference between a two-second fix and an unfalsifiable bug.

      🔴 Safe to return: this route is behind `getAdminUser`, and a Zod issue
      here carries a field name and a bound we chose, never a value the request
      sent and never anything about the database. It is not the `aiErrorBody`
      rule about hiding provider internals from members — it is an operator
      being told which of their own boxes is wrong.
    */
    const fields = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .slice(0, 4)
      .join("; ");
    return NextResponse.json(
      { error: fields ? `Couldn't save — ${fields}` : "Invalid settings payload." },
      { status: 400 },
    );
  }

  try {
    await setLandingSettings(parsed.data);
  } catch {
    return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }

  /*
    ── On-demand revalidation, not just a 60s poll (owner, 2026-08-16: "There's
    a bug that makes when I load frenzsave.com on cold start it shows an older
    version until I refresh") ─────────────────────────────────────────────────

    `/` is `force-static` (app/(marketing)/page.tsx) under `revalidate = 60`
    (app/layout.tsx) — Vercel's ISR serves whatever HTML it last generated and
    only regenerates in the BACKGROUND once a request arrives after that
    60-second window has elapsed, handing the STALE copy to the very request
    that triggered the regeneration. Landing content changes only when an admin
    edits it, not every 60 seconds, so blind time-based polling was buying
    nothing but a guaranteed one-stale-load window on every edit — exactly the
    "shows old, refresh shows current" report, and the more likely trigger the
    fresher this settings panel gets used.

    `revalidatePath("/")` clears the cached HTML the instant a save succeeds,
    so the very next visitor (including the admin, re-checking their own
    change) gets the regenerated page on their FIRST request. The 60s
    time-based revalidate stays as a safety net for any other write path to
    landing-visible data that doesn't (yet) call this — belt and braces, not
    a replacement for it.
  */
  revalidatePath("/");

  /*
    ── Warm the optimizer BEFORE anyone else hits it (owner, 2026-08-16: "when
    I changed image on the landing page wallpaper button, it broke the
    performance") ──────────────────────────────────────────────────────────

    Nothing was actually broken — this is the cold-cache path being caught in
    the act. `ImageUpload` writes every upload to a brand-new storage path
    (`${user.id}/${kind}-${Date.now()}.jpg`), so ANY change to this field is,
    by construction, a URL `next/image` has never optimized before. Vercel's
    image optimizer caches by (url, width, quality) and does the resize/AVIF
    encode SYNCHRONOUSLY on whichever request is first to ask for a given
    combination — and this tile is `priority` (the landing page's measured
    LCP element, see wallpaper-cta.tsx), so that first-request cost lands
    exactly on LCP. An admin who saves a new image and immediately reruns
    Lighthouse is, structurally, guaranteed to be that first request.

    So: fire the same requests a real visitor's `srcset` would make, right
    now, in the background, for every rung `next.config.ts`'s `deviceSizes`
    offers — by the time anyone else (including the admin, testing again a
    minute later) loads the page, every variant is already a cache hit. Quality
    75 matches `next/image`'s own default (wallpaper-cta.tsx sets none).

    `after()`, not awaited: this must not add latency to the admin's save, and
    a serverless function can freeze the instant its response is sent, so a
    bare fire-and-forget call is not reliable here — same reasoning as every
    other `after()` use in this codebase (see the
    [[sw-swx-duplicate-const-bug]] project note).
  */
  const DEVICE_SIZES = [640, 828, 1080, 1920, 2560];
  if (parsed.data.wallpaperCtaImageUrl) {
    const url = parsed.data.wallpaperCtaImageUrl;
    after(async () => {
      await Promise.all(
        DEVICE_SIZES.map((w) =>
          fetch(`${SITE_URL}/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`, { cache: "no-store" }).catch(() => {}),
        ),
      );
    });
  }

  return NextResponse.json({ ok: true });
}
