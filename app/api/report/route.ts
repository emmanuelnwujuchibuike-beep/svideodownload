import { NextResponse } from "next/server";
import { z } from "zod";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(1).max(60),
  note: z.string().trim().max(500).optional(),
});

/** POST /api/report — file a moderation report (auth required). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`report:${clientId(request.headers)}`);
  if (!success) return NextResponse.json({ error: "Too many reports." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid report." }, { status: 400 });

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: parsed.data.targetType,
    target_id: parsed.data.targetId,
    reason: parsed.data.reason,
    note: parsed.data.note ?? null,
  });
  // Duplicate (you already reported this) → treat as success.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Couldn't submit report." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
