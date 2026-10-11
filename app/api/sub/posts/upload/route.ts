import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { subUploadPlan } from "@/lib/sub/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ kind: z.enum(["image", "video"]), ext: z.string().max(8) }).strict();

/** POST — a five-minute upload URL into the creator's own folder of the PRIVATE bucket. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-upload:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const out = await subUploadPlan(user.id, parsed.data.kind, parsed.data.ext);
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
