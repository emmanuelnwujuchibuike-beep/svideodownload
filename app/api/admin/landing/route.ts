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
/** One replacement mode's editable fields (Part 6). */
const modeSchema = z.object({
  enabled: z.boolean().optional(),
  /** The replacement-scope brief §6: a per-video price for the scope. */
  basePriceCents: z.number().int().min(0).max(100_000_000).optional(),
  tiers: z
    .array(
      z.object({
        id: z.enum(["standard", "high", "ultra"]),
        label: z.string().max(12).optional(),
        hint: z.string().max(40).optional(),
        perSecondCents: z.number().int().min(0).max(100_000_000).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .max(3)
    .optional(),
  maximumDurationSeconds: z.number().int().min(1).max(120).optional(),
  maximumUploadBytes: z.number().int().min(1024 * 1024).max(100 * 1024 * 1024).optional(),
  maximumPixels: z.number().int().min(640 * 360).max(3840 * 2160).optional(),
  maximumReferenceImages: z.number().int().min(1).max(3).optional(),
  providerCostPerSecondUsdCents: z.number().min(0).max(100_000).optional(),
  provider: z.object({ model: z.string().max(160).optional() }).optional(),
});

const providerModelSchema = z
  .object({
    model: z.string().max(200).optional(),
    version: z.string().max(120).optional(),
    enabled: z.boolean().optional(),
    maxDurationSeconds: z.number().int().min(1).max(600).nullable().optional(),
    maxEdgePx: z.number().int().min(256).max(4096).nullable().optional(),
    creditMultiplier: z.number().min(0.1).max(10).optional(),
    costUsdCentsPerSecond: z.number().min(0).max(100_000).optional(),
    costUsdCentsPerRun: z.number().min(0).max(100_000).optional(),
    maxConcurrent: z.number().int().min(0).max(100).optional(),
    timeoutMinutes: z.number().int().min(0).max(240).optional(),
    retryCount: z.number().int().min(0).max(5).optional(),
    notes: z.string().max(400).optional(),
  })
  .strict();
const aiPlanSchema = z
  .object({
    enabled: z.boolean().optional(),
    label: z.string().max(24).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    interval: z.enum(["monthly", "yearly"]).optional(),
    dailyCredits: z.number().int().min(0).max(100_000).optional(),
    weeklyCredits: z.number().int().min(0).max(1_000_000).optional(),
    paystackPlanCode: z.string().max(100).optional(),
    blurb: z.string().max(160).optional(),
  })
  .strict();

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
  /** 0167: AI Pro / AI Max, the one-time creations per site plan, the credit rules (bounds mirror AI_PLANS_BOUNDS). */
  frenzAiPlans: z
    .object({
      enabled: z.boolean().optional(),
      plans: z
        .object({
          ai_pro: aiPlanSchema.optional(),
          ai_max: aiPlanSchema.optional(),
        })
        .optional(),
      freeCreations: z
        .object({
          enabled: z.boolean().optional(),
          free: z.number().int().min(0).max(100).nullable().optional(),
          pro: z.number().int().min(0).max(100).nullable().optional(),
          business: z.number().int().min(0).max(100).nullable().optional(),
        })
        .optional(),
      credits: z
        .object({
          centsPerCredit: z.number().int().min(1).max(1_000_000).optional(),
          minimumCredits: z.number().int().min(0).max(10_000).optional(),
          rounding: z.enum(["ceil", "nearest"]).optional(),
          modeMultiplier: z.record(z.string().max(40), z.number().min(0.1).max(20)).optional(),
          qualityMultiplier: z.record(z.string().max(40), z.number().min(0.1).max(20)).optional(),
          featureMultiplier: z.record(z.string().max(40), z.number().min(0.1).max(20)).optional(),
        })
        .optional(),
      reset: z.object({ timezone: z.string().max(80).optional(), weekStartsOn: z.number().int().min(0).max(6).optional() }).optional(),
      walletFallback: z.enum(["allow", "ask", "off"]).optional(),
    })
    .strict()
    .optional(),
  /**
   * 2026-09-21 (the fal.ai brief §10, §11): the provider switch and the model
   * configuration. Text to Speech and Voice Replace take NO provider field —
   * they are ElevenLabs by construction; a patch naming one is refused here
   * (strict) and ignored by the normaliser. Bounds mirror AI_PROVIDERS_BOUNDS.
   */
  frenzAiProviders: z
    .object({
      features: z
        .object({
          character_replace: z
            .object({
              provider: z.enum(["replicate", "fal"]).optional(),
              unsupportedScopes: z.enum(["unavailable", "replicate"]).optional(),
              falScopes: z.object({ upper_body: z.boolean().optional(), full_character: z.boolean().optional() }).strict().optional(),
            })
            .strict()
            .optional(),
          lip_sync: z.object({ provider: z.enum(["replicate", "fal"]).optional() }).strict().optional(),
        })
        .strict()
        .optional(),
      models: z.record(z.enum(["character_replace:replicate", "character_replace:fal", "lip_sync:replicate", "lip_sync:fal"]), providerModelSchema).optional(),
      paused: z.object({ replicate: z.boolean().optional(), fal: z.boolean().optional() }).strict().optional(),
      adminJobsAreTests: z.boolean().optional(),
    })
    .strict()
    .optional(),
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
      providerGoFast: z.boolean().optional(),
      lipSyncEnabled: z.boolean().optional(),
      lipSync: z
        .array(
          z.object({
            id: z.enum(["standard", "studio"]),
            label: z.string().max(20).optional(),
            blurb: z.string().max(120).optional(),
            perSecondCents: z.number().int().min(0).max(1_000_000).optional(),
            enabled: z.boolean().optional(),
            /** Part 6 §26: the lip-sync model behind the tier ("owner/model"). */
            model: z.string().max(160).optional(),
          }),
        )
        .max(2)
        .optional(),
      lipSyncMaximumDurationSeconds: z.number().int().min(1).max(120).optional(),
      /*
        ── Part 6: the two new modes, the audio, the voice ─────────────────
        Bounds mirror the normaliser's; the normaliser is still the control.
      */
      modes: z
        .object({
          face_only: modeSchema.optional(),
          skin_face: modeSchema.optional(),
          upper_body: modeSchema.optional(),
        })
        .optional(),
      /** Part 11 §5, §18: complimentary creations and the device rule. */
      freeAccess: z
        .object({
          enabled: z.boolean().optional(),
          creationsPerAccount: z.number().int().min(0).max(100).optional(),
          entitlement: z.literal("lifetime").optional(),
          maxDurationSeconds: z.number().int().min(1).max(120).optional(),
          maxQualityRank: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
          allowedModes: z.array(z.enum(["face_only", "skin_face", "upper_body", "full_character"])).max(4).optional(),
          allowTts: z.boolean().optional(),
          allowUploadedVoice: z.boolean().optional(),
          allowLipSync: z.boolean().optional(),
          maxUploadBytes: z.number().int().min(1024 * 1024).max(100 * 1024 * 1024).optional(),
        })
        .optional(),
      antiAbuse: z
        .object({
          maxFreeAccountsPerDevice: z.number().int().min(0).max(1_000).optional(),
          deviceDetection: z.boolean().optional(),
          maxFreeAccountsPerNetwork: z.number().int().min(0).max(10_000).optional(),
          networkWindowHours: z.number().int().min(1).max(720).optional(),
          signupRateLimit: z.boolean().optional(),
          verificationAfterLimit: z.boolean().optional(),
          paidUsersExempt: z.boolean().optional(),
          adminExempt: z.boolean().optional(),
        })
        .optional(),
      /** The replacement-scope brief §13: provider cost protection. */
      pricingGuard: z
        .object({
          minimumMarginPercent: z.number().min(0).max(1_000).optional(),
          minimumCustomerPriceCents: z.number().int().min(0).max(100_000_000).optional(),
          allowBelowMargin: z.boolean().optional(),
        })
        .optional(),
      audio: z
        .object({
          replacementEnabled: z.boolean().optional(),
          maximumDurationSeconds: z.number().int().min(1).max(30 * 60).optional(),
          maximumUploadBytes: z.number().int().min(64 * 1024).max(100 * 1024 * 1024).optional(),
          shorterAudio: z.enum(["silence", "reject"]).optional(),
          minimumCoverageFraction: z.number().min(0).max(1).optional(),
          syncMode: z.enum(["silence", "loop", "bounce"]).optional(),
        })
        .optional(),
      tts: z
        .object({
          enabled: z.boolean().optional(),
          model: z.string().max(160).optional(),
          perRequestCents: z.number().int().min(0).max(100_000_000).optional(),
          perCharacterCents: z.number().int().min(0).max(1_000_000).optional(),
          minimumCharacters: z.number().int().min(1).max(10_000).optional(),
          maximumCharacters: z.number().int().min(1).max(10_000).optional(),
          /** 2026-09-20: the voice changer — an upload re-voiced in a catalogue voice, priced per second. */
          voiceChange: z
            .object({
              enabled: z.boolean().optional(),
              model: z.string().max(160).optional(),
              perSecondCents: z.number().int().min(0).max(100_000_000).optional(),
            })
            .optional(),
        })
        .optional(),
      /** Part 7 §21: retention, configuration-driven. */
      retention: z.object({ resultHours: z.number().int().min(1).max(24 * 30).optional(), savedResultDays: z.number().int().min(1).max(365).optional() }).optional(),
      /** Part 8 §2, §7: the switches and the breaker. */
      ops: z
        .object({
          processingEnabled: z.boolean().optional(),
          maintenanceMode: z.boolean().optional(),
          maintenanceMessage: z.string().max(300).optional(),
          /** Part 10 §25: the launch mode. */
          launchMode: z.enum(["production", "internal"]).optional(),
          circuitBreaker: z
            .object({
              enabled: z.boolean().optional(),
              failureThreshold: z.number().int().min(1).max(1_000).optional(),
              windowSeconds: z.number().int().min(30).max(86_400).optional(),
              cooldownSeconds: z.number().int().min(30).max(86_400).optional(),
            })
            .optional(),
        })
        .optional(),
      /** Part 8 §4, §8: the limits (0 = no cap of that kind). */
      limits: z
        .object({
          maxActiveJobsPerUser: z.number().int().min(0).max(100).optional(),
          maxActiveJobsGlobal: z.number().int().min(0).max(10_000).optional(),
          maxJobsPerUserPerDay: z.number().int().min(0).max(10_000).optional(),
        })
        .optional(),
      /** 0166 (multi-video): the AI → Processing section. Bounds mirror CHARACTER_REPLACE_PROCESSING_BOUNDS. */
      processing: z
        .object({
          queueEnabled: z.boolean().optional(),
          concurrency: z
            .object({
              free: z.number().int().min(1).max(10).optional(),
              pro: z.number().int().min(1).max(10).optional(),
              business: z.number().int().min(1).max(10).optional(),
              maxAi: z.number().int().min(1).max(10).optional(),
              admin: z.number().int().min(1).max(20).optional(),
            })
            .optional(),
          maxVideosPerBatch: z.number().int().min(1).max(20).optional(),
          autoRetryCount: z.number().int().min(1).max(5).optional(),
          jobTimeoutMinutes: z.number().int().min(20).max(180).optional(),
          refundFailedJobs: z.boolean().optional(),
        })
        .optional(),
      /** Part 8 §25: local minor units per US dollar, for the margin warnings. */
      localMinorUnitsPerUsd: z.number().int().min(0).max(100_000_000).optional(),
      /** Part 6 §27: why the prices changed. Recorded in the pricing history beside the admin's id; never stored as a setting. */
      pricingChangeReason: z.string().max(300).optional(),
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
            /** Part 6: the configured TTS provider's own id for this voice. */
            providerVoiceId: z.string().max(80).optional(),
            /** 2026-09-20: which provider the id belongs to, and the gender/age a member filters by. */
            provider: z.enum(["minimax", "elevenlabs", "elevenlabs_api"]).optional(),
            gender: z.enum(["female", "male", "neutral"]).optional(),
            age: z.enum(["young", "middle_aged", "old"]).optional(),
          }),
        )
        .max(80)
        .optional(),
      trim: z.object({ enabled: z.boolean().optional(), minimumSeconds: z.number().min(0.5).max(30).optional() }).optional(),
      voice: z
        .object({ newVoiceEnabled: z.boolean().optional(), surchargePerSecondCents: z.number().int().min(0).max(100_000_000).optional() })
        .optional(),
      recharge: z
        .object({
          /** 2026-09-20: the currency Paystack collects in when the wallet is USD (Paystack's own settlement set, same as frenzAiCurrency). */
          checkoutCurrency: z.enum(["USD", "NGN", "GHS", "ZAR", "KES"]).optional(),
          /** 2026-09-20: percent added on top of the live market rate at checkout. */
          fxMarkupPercent: z.number().min(0).max(50).optional(),
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
    // Part 6 §27: the reason rides beside the config, not inside it; the settings writer records it with the admin's id.
    const { pricingChangeReason, ...crPatch } = parsed.data.frenzAiCharacterReplace ?? {};
    const patch = parsed.data.frenzAiCharacterReplace ? { ...parsed.data, frenzAiCharacterReplace: crPatch } : parsed.data;
    await setLandingSettings(patch, { changedBy: admin.id, reason: pricingChangeReason ?? null });
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
