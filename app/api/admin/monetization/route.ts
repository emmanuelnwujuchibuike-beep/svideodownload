import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
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
  // Server-verified reward-session gate for HD/batch downloads (see
  // lib/monetization/reward-sessions.ts). Independent of the reward-AD tier/
  // duration settings above, which decide whether a request is gated at all.
  rewardDownloadHdEnabled: z.boolean().default(true),
  rewardDownloadBatchEnabled: z.boolean().default(true),
  // 0 = unlimited. Capped at 1000/day as a sanity ceiling, not a real limit.
  rewardHdDailyLimit: z.number().int().min(0).max(1000).default(0),
  rewardBatchDailyLimit: z.number().int().min(0).max(1000).default(0),
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
