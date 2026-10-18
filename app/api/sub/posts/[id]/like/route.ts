import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { interactionSummary, setLike } from "@/lib/sub/interactions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const headers = { "Cache-Control": "private, no-store" };

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** GET — likes, comments and whether I liked it (subscribers and the creator only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const out = await interactionSummary(id, await me());
  return out.ok ? NextResponse.json(out, { headers }) : NextResponse.json({ error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status, headers });
}

/** POST { like: boolean } — like or unlike. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const uid = await me();
  if (uid) {
    const { success } = await trackLimiter.limit(`sub-like:${uid}`);
    if (!success) return NextResponse.json({ error: "Too many taps — try again in a moment." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { like?: unknown } | null;
  if (typeof body?.like !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await setLike(id, uid, body.like);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status });
}
