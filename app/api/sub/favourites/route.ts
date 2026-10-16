import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { addFavourite, listFavourites, removeFavourite } from "@/lib/sub/favourites";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const body = z.object({ op: z.enum(["add", "remove"]), creatorId: z.string().uuid() }).strict();

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** GET ?cursor= — the signed-in member's own favourite creators, 24 a page (Frenz Exclusive Part 6). */
export async function GET(request: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your favourites." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-fav-list:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: HEADERS });
  const out = await listFavourites(user.id, new URL(request.url).searchParams.get("cursor"));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: HEADERS });
  return NextResponse.json({ items: out.items, next: out.next }, { headers: HEADERS });
}

/** POST { op: "add" | "remove", creatorId } — the session user's own favourites only; both idempotent. Never touches a subscription. */
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-fav:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: HEADERS });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: HEADERS });
  const out = parsed.data.op === "add" ? await addFavourite(user.id, parsed.data.creatorId) : await removeFavourite(user.id, parsed.data.creatorId);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status, headers: HEADERS });
  return NextResponse.json({ ok: true, favourite: parsed.data.op === "add", already: out.already }, { headers: HEADERS });
}
