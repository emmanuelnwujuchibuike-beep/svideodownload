import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { listReportedTargets, moderate } from "@/lib/social/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  // sub_post / sub_comment: exclusive content (0247) — remove (archive / hide), restore or dismiss only
  targetType: z.enum(["post", "comment", "user", "sub_post", "sub_comment"]),
  targetId: z.string().uuid(),
  // hide/unhide are friends-only visibility (migration 0082) and are NOT
  // synonyms for suspend/unsuspend, which remain a full lockout.
  action: z.enum(["remove", "restore", "suspend", "unsuspend", "hide", "unhide", "dismiss"]),
  // Frenz Exclusive Part 7: the admin's reason (kept on the audit entry; plain text)
  note: z.string().trim().max(300).optional(),
});

/** GET — the moderation queue (open reports grouped by target). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ targets: await listReportedTargets() });
}

/** POST — apply a moderation action + resolve the target's reports. */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  if ((parsed.data.targetType === "sub_post" || parsed.data.targetType === "sub_comment") && !["remove", "restore", "dismiss"].includes(parsed.data.action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const res = await moderate(parsed.data.targetType, parsed.data.targetId, parsed.data.action, admin.id, parsed.data.note ?? null);
  // an invalid transition (restoring what isn't removed) says so; anything else stays a generic failure
  if (!res.ok) return NextResponse.json({ error: res.status === 409 || res.status === 404 ? res.error : "Action failed." }, { status: res.status === 409 || res.status === 404 ? res.status : 500 });
  return NextResponse.json({ ok: true, state: res.state ?? null, changed: res.changed ?? null });
}
