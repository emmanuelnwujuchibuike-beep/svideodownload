import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { createPromotion, creatorPromotions, updatePromotion } from "@/lib/sub/promotions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / POST /api/sub/promotions — the signed-in creator's OWN Exclusive promotions (0277). The creator is always the
 * session user: an id belonging to someone else answers "not found". Prices are checked on the server against the
 * creator's current prices (lib/sub/pricing.ts validatePromotion); nothing here changes a purchase already made.
 */
const rule = {
  name: z.string().max(80),
  description: z.string().max(400).nullable().optional(),
  kind: z.enum(["percent", "fixed"]),
  percentOff: z.number().int().nullable().optional(),
  fixedPriceCents: z.number().int().nullable().optional(),
  durations: z.array(z.number().int()).min(1).max(4),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  maxRedemptions: z.number().int().nullable().optional(),
};
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), ...rule }).strict(),
  z.object({ op: z.literal("edit"), id: z.string().uuid(), ...rule }).strict(),
  z.object({ op: z.literal("pause"), id: z.string().uuid() }).strict(),
  z.object({ op: z.literal("resume"), id: z.string().uuid() }).strict(),
]);

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const out = await creatorPromotions(user.id);
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-promotions:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out =
    b.op === "create" ? await createPromotion(user.id, b)
    : b.op === "edit" ? await updatePromotion(user.id, b.id, b)
    : await updatePromotion(user.id, b.id, { op: b.op });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
