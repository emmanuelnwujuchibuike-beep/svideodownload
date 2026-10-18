import { NextResponse } from "next/server";
import { z } from "zod";

import { readAgeState, recordAgeCheck } from "@/lib/age/server";
import { trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The age check (0261, owner 2026-10-18: date of birth + an 18+ confirmation, for Mature
  exclusive posts). The browser sends the date it was given; the server decides from it and keeps
  only the outcome — never the date. Per viewer, never cached.
*/
const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET — this member's answer: adult, minor (with the day they may answer again) or none. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ status: "none", eligibleOn: null }, { headers: NO_STORE });
  return NextResponse.json(await readAgeState(user.id), { headers: NO_STORE });
}

const body = z.object({ birthDate: z.string().max(10), confirm: z.boolean() }).strict();

/** POST { birthDate: "YYYY-MM-DD", confirm } — answer the check. An adult answer is final; a minor's stands until they turn 18. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to confirm your age." }, { status: 401, headers: NO_STORE });
  const { success } = await trackLimiter.limit(`age-check:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many tries — wait a moment." }, { status: 429, headers: NO_STORE });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter your date of birth." }, { status: 400, headers: NO_STORE });
  const out = await recordAgeCheck(user.id, parsed.data.birthDate, parsed.data.confirm);
  return out.ok ? NextResponse.json(out, { headers: NO_STORE }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status, headers: NO_STORE });
}
