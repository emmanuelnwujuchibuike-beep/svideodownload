import { after, NextResponse } from "next/server";
import { z } from "zod";

import { notifyAdminsOfReferralShare } from "@/lib/analytics/referral-alert";
import { shareLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ how: z.enum(["copied", "shared"]), surface: z.enum(["rewards", "banner", "friends"]) }).strict();

/**
 * POST /api/referrals/shared — a member just copied (or shared) their invite
 * link. Owner, 2026-10-09: "make admin receive push notifications on every user
 * who copied the referral link". Signed-in only, the actor is the session (never
 * the body), capped per member so a tap-happy thumb cannot flood the admins.
 * Answers at once; the push goes out after the response.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const burst = await shareLimiter.limit(`referral-alert:${user.id}`);
  if (!burst.success) return NextResponse.json({ ok: true, alerted: false });
  after(() => notifyAdminsOfReferralShare(user.id, parsed.data.how, parsed.data.surface === "rewards" ? "Rewards page" : parsed.data.surface === "friends" ? "Add friends page" : "referral banner"));
  return NextResponse.json({ ok: true, alerted: true });
}
