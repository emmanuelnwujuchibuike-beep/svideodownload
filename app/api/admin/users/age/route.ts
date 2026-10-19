import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { resetAgeCheck } from "@/lib/age/server";
import { writeAuditLog } from "@/lib/security/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ userId: z.string().uuid() }).strict();

/**
 * DELETE /api/admin/users/age — clear a member's age answer (0261, owner 2026-10-18: "I want admin
 * to be able to reset someone's age answers"). They answer again the next time a Mature post asks.
 * Admin-gated by the same guard as every admin route, and audited (who reset whose answer, and
 * what it was). There is no admin way to SET an answer: only the member can, by answering.
 */
export async function DELETE(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await resetAgeCheck(parsed.data.userId);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  if (out.cleared) {
    await writeAuditLog({
      userId: parsed.data.userId,
      actorUserId: admin.id,
      eventType: "moderation_action",
      targetType: "user",
      targetId: parsed.data.userId,
      request,
      metadata: { action: "age_check_reset", previous: out.cleared.status },
    });
  }
  return NextResponse.json({ ok: true, cleared: !!out.cleared });
}
