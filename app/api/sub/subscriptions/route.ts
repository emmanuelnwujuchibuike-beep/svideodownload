import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { cancelSubscription, mySubscriptions, resumeSubscription } from "@/lib/sub/subscriptions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const body = z.object({ op: z.enum(["cancel", "resume"]), creatorId: z.string().uuid() }).strict();

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * GET — the signed-in member's own paid subscriptions (Frenz Exclusive Part 5): state, access
 * until, and what they can do. Read with the session's id only.
 */
export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your subscriptions." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-subs:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: HEADERS });
  const out = await mySubscriptions(user.id);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: HEADERS });
  return NextResponse.json({ items: out.items }, { headers: HEADERS });
}

/**
 * POST { op: "cancel" | "resume", creatorId } — cancel at the end of the paid period, or take
 * that back. Neither changes access or money; repeating either answers `already`. Renewing is
 * the existing /api/sub/checkout (a new verified payment), never this route.
 */
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-cancel:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: HEADERS });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: HEADERS });
  const out = parsed.data.op === "cancel" ? await cancelSubscription(user.id, parsed.data.creatorId) : await resumeSubscription(user.id, parsed.data.creatorId);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status, headers: HEADERS });
  return NextResponse.json(out, { headers: HEADERS });
}
