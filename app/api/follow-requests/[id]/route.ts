import { NextResponse } from "next/server";
import { z } from "zod";

import { respondFollowRequest } from "@/lib/social/follows";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  action: z.enum(["approve", "decline", "ignore"]),
  /** Approve with Label — a private relationship label (validated by resolveLabelInput) */
  as: z.string().trim().min(1).max(32).optional(),
});

/** POST /api/follow-requests/:id — answer a follow request sent to you. Only the target can. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  const ok = await respondFollowRequest(user.id, id, parsed.data.action, parsed.data.action === "approve" ? (parsed.data.as ?? null) : null);
  if (!ok) return NextResponse.json({ error: "That request isn't waiting any more." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
