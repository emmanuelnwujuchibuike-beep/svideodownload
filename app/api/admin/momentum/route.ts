import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setMomentumSettings } from "@/lib/social/momentum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  wCompletion: z.number().min(0).max(1000),
  wVelocity: z.number().min(0).max(1000),
  wRepost: z.number().min(0).max(1000),
  gravity: z.number().min(0).max(10),
  maxAgeHours: z.number().int().min(1).max(8760),
});

/** Admin-only: update the Momentum Engine weights (Feature 15 Part 8). */
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
    return NextResponse.json({ error: "Invalid momentum settings." }, { status: 400 });
  }

  try {
    await setMomentumSettings(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
}
