import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { DEFAULT_VAST_INTERSTITIAL } from "@/lib/monetization/vast-interstitial";
import { MONETAG_AD_TYPE_IDS, MONETAG_PLACEMENT_IDS, MONETAG_SURFACE_IDS } from "@/lib/monetization/monetag";
import { setMonetizationSettings } from "@/lib/monetization/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  `popunder` was dropped with the format. A payload from a cached older client
  may still include it; `.strip()` (zod's default for unknown keys) discards it
  rather than 400ing an otherwise valid save.
*/
const schema = z.object({
  adsense: z.boolean(),
  adsterra: z.boolean(),
  propellerads: z.boolean(),
  // Monetag (Multitag) — the owner's network alongside AdSense.
  monetag: z.boolean().default(false),
  // The pasted Monetag <script> snippet; parsed (not injected) at render time.
  monetagSnippet: z.string().max(4000).default(""),
  /*
    Per-type Monetag tags (In-Page Push, Push Notifications, Vignette Banner,
    OnClick/Popunder, extra Multitags). Each snippet is parsed — never injected —
    at render time. Capped so a payload can't bloat the settings row; the type is
    an enum so only known formats are accepted.
  */
  monetagUnits: z
    .array(
      z.object({
        type: z.enum(MONETAG_AD_TYPE_IDS),
        snippet: z.string().max(4000),
      }),
    )
    .max(20)
    .default([]),
  // Page scope: show Monetag everywhere (default) or only on selected surfaces.
  monetagAllPages: z.boolean().default(true),
  monetagSurfaces: z.array(z.enum(MONETAG_SURFACE_IDS)).max(20).default([]),
  // Moment placements: one Monetag tag per moment, parsed (not injected) client-side.
  monetagPlacements: z
    .array(z.object({ moment: z.enum(MONETAG_PLACEMENT_IDS), snippet: z.string().max(4000) }))
    .max(10)
    .default([]),
  affiliates: z.boolean(),
  recommendedTools: z.boolean(),
  interstitial: z.boolean(),
  // How long before an interstitial can be skipped: 0 / 5 / 10 seconds only.
  interstitialSkipSeconds: z
    .number()
    .refine((v) => [0, 5, 10].includes(v), { message: "Skip delay must be 0, 5 or 10 seconds" })
    .default(5),
  // Per-moment interstitial switches. Default false so an existing saved
  // settings row (written before these existed) can never come back with an
  // intrusive placement silently switched on.
  interstitialWallpaper: z.boolean().default(false),
  interstitialHistoryVideo: z.boolean().default(false),
  /*
    Batch downloads: free, paid for by an ad before and a short one after.
    Defaulted rather than required so a saved settings row written before these
    existed still validates — an operator should not have their whole
    monetization form rejected because we added a field.
  */
  interstitialBatchDownload: z.boolean().default(false),
  // 30s is the owner's figure. Capped at 60: past that an "ad you must watch"
  // stops being a price and becomes a reason to leave.
  batchGateSeconds: z.number().int().min(0).max(60).default(30),
  batchCompleteSeconds: z.number().int().min(0).max(30).default(5),
  // How many of the leading (best-first) format options per kind count as
  // "top tier" for the reward-ad gate below.
  rewardTopTierCount: z.number().int().min(0).max(10).default(2),
  rewardVideoTopTierSeconds: z.number().int().min(0).max(60).default(30),
  rewardImageAudioTopTierSeconds: z.number().int().min(0).max(30).default(5),
  rewardImageAudioSkipAfterSeconds: z.number().int().min(0).max(30).default(5),
  popunder: z.boolean().default(false),
  /*
    ExoClick serving. Defaults FALSE, and the default is load-bearing: a save
    posted by an older cached client omits this key entirely, and defaulting it
    to true would silently switch the network on across the whole site as a
    side effect of an unrelated settings change.
  */
  exoclick: z.boolean().default(false),
  /*
    Per-zone opt-out, keyed by zone id. Unknown keys are stripped rather than
    rejected so a save from a client that still knows about a removed zone is
    not a 400 on an otherwise valid form, and `normalizeExoClickZones` applies
    the same filter again on the way back out.
  */
  exoclickZones: z.record(z.enum(AD_ZONES), z.boolean()).default({}),
  /* Bounds mirror VAST_LIMITS. Validated server-side per the brief: a negative
     or absurd value must never reach the player, and a missing block falls back
     to the safe defaults rather than 400ing an otherwise valid save. */
  vastInterstitial: z
    .object({
      enabled: z.boolean().default(false),
      /* Defaults mirror DEFAULT_VAST_INTERSTITIAL exactly — the start moment is
         OFF and the completion moment is ON, because both firing for one
         download means the cooldown silently eats the second one. */
      enabledOnDownload: z.boolean().default(false),
      enabledOnDownloadComplete: z.boolean().default(true),
      skipEnabled: z.boolean().default(true),
      skipAfterSeconds: z.number().int().min(0).max(30).default(5),
      timeoutMs: z.number().int().min(500).max(5000).default(3000),
      cooldownMs: z.number().int().min(0).max(86400000).default(90000),
    })
    .default(DEFAULT_VAST_INTERSTITIAL),
  /*
    One zone id for every ExoClick placement. Empty clears it. Shape-checked
    rather than merely trimmed: the whole snippet pasted in by mistake
    (`https://s.magsrv.com/v1/vast.php?idzone=123`) would otherwise be written
    into a VAST URL that 404s, and the symptom is silence.
  */
  /* Free text, PARSED at render into an <ins> — never injected. Capped so a
     payload cannot bloat the settings row. */
  exoclickStickySnippet: z.string().max(4000).default(""),
  exoclickBottomNavSnippet: z.string().max(4000).default(""),
  exoclickHistorySnippet: z.string().max(4000).default(""),
  exoclickMultiFormatSnippet: z.string().max(4000).default(""),
  exoclickHistoryUseMultiFormat: z.boolean().default(true),
  exoclickHistoryFeedSnippet: z.string().max(4000).default(""),
  exoclickLandingSnippet: z.string().max(4000).default(""),
  exoclickInterstitialSnippet: z.string().max(4000).default(""),
  exoclickSharedZoneId: z
    .string()
    .trim()
    .regex(/^\d{4,20}$/, "Just the numeric Zone ID — not the whole vast.php link")
    .or(z.literal(""))
    .default(""),
  // Server-verified reward-session gate for HD/batch downloads (see
  // lib/monetization/reward-sessions.ts). Independent of the reward-AD tier/
  // duration settings above, which decide whether a request is gated at all.
  rewardDownloadHdEnabled: z.boolean().default(true),
  rewardDownloadBatchEnabled: z.boolean().default(true),
  // 0 = unlimited. Capped at 1000/day as a sanity ceiling, not a real limit.
  rewardHdDailyLimit: z.number().int().min(0).max(1000).default(0),
  rewardBatchDailyLimit: z.number().int().min(0).max(1000).default(0),
  // The GPT-rewarded "Review video" preview (owner 2026-08-16 spec) — a
  // second, independent reward context from HD/batch.
  rewardDownloadPreviewEnabled: z.boolean().default(true),
  rewardPreviewDailyLimit: z.number().int().min(0).max(1000).default(0),
  /*
    Validated as "empty, or a well-formed publisher id" rather than just a
    string. A malformed id produces a script URL that 404s and shows no ads at
    all, with nothing in the UI to indicate why — so it is worth refusing the
    save and saying so.
  */
  adsensePublisherId: z
    .string()
    .trim()
    // Lowercased first: `Ca-pub-…` from an autocapitalising keyboard is the
    // same id, and rejecting it names the exact string the operator typed.
    .toLowerCase()
    .max(40)
    .refine((v) => v === "" || /^ca-pub-\d{10,20}$/.test(v), {
      message: "Publisher ID must look like ca-pub-1234567890123456",
    })
    .default(""),
  /*
    Offerium — public config only (owner, 2026-08-23). The API key and postback
    signing secret are intentionally NOT accepted here: this payload is written
    to a settings row an admin edits and an allowlisted subset is served
    publicly, so a signing secret arriving through this endpoint would be a
    reward-forgery primitive. They are server env vars — see
    lib/monetization/offerium.ts.
  */
  offerium: z.boolean().default(false),
  /*
    Refused unless it is empty or a well-formed https URL. An http script is
    blocked outright by the browser on an https page, and a malformed one throws
    at construction — both fail silently at render with no ad and no
    explanation, so the save is the right place to catch it.
  */
  offeriumSdkUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => {
        if (v === "") return true;
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "SDK URL must be a full https:// URL" },
    )
    .default(""),
  offeriumPublisherId: z.string().trim().max(120).default(""),
  offeriumPlacementId: z.string().trim().max(120).default(""),
  // "allow" falls back to normal download rules; "block" keeps the gate shut.
  // Neither ever grants the reward.
  offeriumFallback: z.enum(["allow", "block"]).default("allow"),
  // Free text: several networks each contribute a line, and the AdSense line
  // ends in an account-specific hash that cannot be derived or checked here.
  adsTxt: z.string().max(8000).default(""),
  // Free text, parsed into name|content pairs at render time and emitted as
  // real meta elements — never as markup. See VerificationTags.
  verificationTags: z.string().max(4000).default(""),
  /*
    The ID only — validated here as well as at render. An empty string clears
    it. Anything that is not one of Google's three id shapes is rejected at the
    door rather than stored and silently ignored, so an operator who pastes the
    whole <script> block is told, instead of wondering why nothing tracked.
  */
  googleTagId: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === "" || /^(?:G-[A-Z0-9]{6,12}|AW-[0-9]{9,12}|GTM-[A-Z0-9]{6,10})$/i.test(v), {
      message: "Enter a Google tag ID like G-XXXXXXXXXX, AW-XXXXXXXXX or GTM-XXXXXXX — not the whole script.",
    })
    .default(""),
});

/** Admin-only: flip the global monetization subsystems on/off. */
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
    // The FIRST field message, not a generic one. "Invalid settings payload"
    // leaves an operator who pasted a whole <script> block with no idea which
    // of twenty fields is wrong or why.
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? "Invalid settings payload." }, { status: 400 });
  }

  try {
    await setMonetizationSettings(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }
}
