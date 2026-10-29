import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { blurClipsToMake, saveBlurClip } from "@/lib/sub/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  0306 — older exclusive videos get their blurred clip from their creator's own browser (owner, 2026-10-29: every locked
  video plays blurred, and an album slides). GET: up to two of the creator's videos still without one, each with a
  five-minute link to their OWN private file. POST: the clip the browser made, uploaded to our public media host like a
  cover. The clip is 24 px wide — the detail is gone before it leaves the device.
*/
const NO_STORE = { "Cache-Control": "private, no-store" };

async function viewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await viewer();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ ok: true, todo: await blurClipsToMake(user.id).catch(() => []) }, { headers: NO_STORE });
}

const body = z.object({ postId: z.string().uuid(), idx: z.number().int().min(0).max(19), url: z.string().max(600) }).strict();

export async function POST(req: Request) {
  const user = await viewer();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-blur-clip:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const out = await saveBlurClip(user.id, parsed.data.postId, parsed.data.idx, parsed.data.url);
  return out.ok ? NextResponse.json(out, { headers: NO_STORE }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
