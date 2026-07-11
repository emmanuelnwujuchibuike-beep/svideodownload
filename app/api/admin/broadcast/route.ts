import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdmin } from "@/lib/admin";
import { assistantLimiter } from "@/lib/rate-limit";
import { createAndSendBroadcast, listBroadcasts } from "@/lib/social/broadcasts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!isAdmin(profile?.role as string | null, user.email)) return null;
  return user;
}

/** GET /api/admin/broadcast — recent broadcast history. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const broadcasts = await listBroadcasts();
  return NextResponse.json({ broadcasts });
}

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  targetPlan: z.enum(["all", "free", "pro", "business"]),
});

/** POST /api/admin/broadcast — create + immediately fan out a broadcast alert. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Admin-only, but still real fan-out work (up to thousands of writes/pushes) — worth its own budget, distinct from a normal user action.
  const { success } = await assistantLimiter.limit(`broadcast:${admin.id}`);
  if (!success) return NextResponse.json({ error: "Too many broadcasts — wait a moment." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Title and body are required." }, { status: 400 });

  const res = await createAndSendBroadcast(admin.id, parsed.data.title, parsed.data.body, parsed.data.targetPlan);
  if (!res.ok) return NextResponse.json({ error: "Couldn't send — no matching users or a write failed." }, { status: 400 });
  return NextResponse.json({ ok: true, sent: res.sent });
}
