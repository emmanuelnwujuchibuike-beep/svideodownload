import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
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
  affiliates: z.boolean(),
  recommendedTools: z.boolean(),
  interstitial: z.boolean(),
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
