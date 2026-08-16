import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getPromoSettings, PROMO_DURATIONS, setPromoSettings } from "@/lib/monetization/promo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"),
    duration: z.enum(Object.keys(PROMO_DURATIONS) as [keyof typeof PROMO_DURATIONS]),
  }),
  z.object({ action: z.literal("deactivate") }),
]);

/** Admin-only: current promo state. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getPromoSettings());
}

/** Admin-only: activate (for a picked duration) or deactivate the promo. */
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
    return NextResponse.json({ error: "Invalid promo payload." }, { status: 400 });
  }

  try {
    if (parsed.data.action === "deactivate") {
      await setPromoSettings({ active: false, startedAt: null, endsAt: null });
    } else {
      const days = PROMO_DURATIONS[parsed.data.duration];
      const now = Date.now();
      await setPromoSettings({ active: true, startedAt: now, endsAt: now + days * 86_400_000 });
    }
    return NextResponse.json(await getPromoSettings());
  } catch {
    return NextResponse.json({ error: "Couldn't save the promo." }, { status: 500 });
  }
}
