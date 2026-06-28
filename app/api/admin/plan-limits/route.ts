import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setPlanLimits } from "@/lib/monetization/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const caps = z.object({
  dailyDownloads: z.number().int().min(0).max(10_000_000),
  apiDailyLimit: z.number().int().min(0).max(10_000_000),
});
const schema = z.object({ free: caps, pro: caps, business: caps });

/** Admin-only: update the per-plan daily download + API caps. */
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
      { error: "Each plan needs a numeric dailyDownloads and apiDailyLimit." },
      { status: 400 },
    );
  }

  try {
    await setPlanLimits(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save limits." }, { status: 500 });
  }
}
