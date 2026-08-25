import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setMultiLinkSettings } from "@/lib/downloads/multi-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Bounds mirror the admin form's own `min`/`max`, because an HTML input's
  attributes are a hint to a browser, not a constraint on a request. The
  ceilings are deliberately generous — this is an admin choosing a product
  policy, not an untrusted caller — but finite, so a typo in the dashboard
  cannot set a 10,000-source limit that the batch endpoints would then honour.
*/
const schema = z.object({
  enabled: z.boolean(),
  freeSourceLimit: z.number().int().min(1).max(20),
  proSourceLimit: z.number().int().min(1).max(20),
  freeDailyBatches: z.number().int().min(0).max(100),
  rewardRequired: z.boolean(),
  proSkipsReward: z.boolean(),
  fetchConcurrency: z.number().int().min(1).max(6),
  upsellMessage: z.string().trim().max(200),
});

/** Admin-only: update the Multi-Link Batch Downloader settings (§34). */
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settings." },
      { status: 400 },
    );
  }

  try {
    await setMultiLinkSettings(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
}
