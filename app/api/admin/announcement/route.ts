import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getAnnouncementConfig, setAnnouncementConfig, type Announcement } from "@/lib/announcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/announcement — the full stored announcement config. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getAnnouncementConfig());
}

/** POST /api/admin/announcement — save the announcement. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: Partial<Announcement>;
  try {
    body = (await request.json()) as Partial<Announcement>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const saved = await setAnnouncementConfig(body);
  return NextResponse.json({ ok: true, announcement: saved });
}
