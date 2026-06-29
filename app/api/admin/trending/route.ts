import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setTrendingSettings } from "@/lib/social/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (max: number) => z.number().min(0).max(max);
const schema = z.object({
  wView: num(1000),
  wDownload: num(1000),
  wLike: num(1000),
  wSave: num(1000),
  wShare: num(1000),
  wComment: num(1000),
  gravity: z.number().min(0).max(10),
  maxAgeHours: z.number().int().min(1).max(8760),
  diversityCap: z.number().int().min(1).max(50),
});

/** Admin-only: update the trending weights / gravity / diversity cap. */
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
    return NextResponse.json({ error: "Invalid trending settings." }, { status: 400 });
  }

  try {
    await setTrendingSettings(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
}
