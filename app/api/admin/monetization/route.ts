import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { MONETAG_AD_TYPE_IDS, MONETAG_SURFACE_IDS } from "@/lib/monetization/monetag";
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
  affiliates: z.boolean(),
  recommendedTools: z.boolean(),
  interstitial: z.boolean(),
  // How long before an interstitial can be skipped: 0 / 5 / 10 seconds only.
  interstitialSkipSeconds: z
    .number()
    .refine((v) => [0, 5, 10].includes(v), { message: "Skip delay must be 0, 5 or 10 seconds" })
    .default(5),
  popunder: z.boolean().default(false),
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
    return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  try {
    await setMonetizationSettings(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }
}
