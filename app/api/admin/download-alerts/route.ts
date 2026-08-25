import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getDownloadAlerts, setDownloadAlerts } from "@/lib/analytics/download-alert-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only: the "🎉 N downloads" milestone email — its interval and its
 * on/off switch.
 *
 * Owner, 2026-08-24: "i can turn off, extend or shorten the download threshold
 * email alert from 100 to any number or turn it off." It was a build-time
 * environment variable, so every change meant a redeploy.
 */
const schema = z.object({
  // 1 would email on literally every download; the floor is deliberately low
  // anyway, because a small site legitimately wants to hear about 10 or 25.
  every: z.number().int().min(1).max(10_000_000),
  enabled: z.boolean(),
});

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getDownloadAlerts());
}

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
      { error: "Needs a whole number of downloads (1 or more) and an on/off switch." },
      { status: 400 },
    );
  }

  try {
    await setDownloadAlerts(parsed.data);
    return NextResponse.json({ ok: true, ...parsed.data });
  } catch {
    return NextResponse.json({ error: "Couldn't save the alert settings." }, { status: 500 });
  }
}
