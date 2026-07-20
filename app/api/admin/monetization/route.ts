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
