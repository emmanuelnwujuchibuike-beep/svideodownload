import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setRewardRestriction } from "@/lib/rewards/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email().max(320), restricted: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();

/**
 * POST /api/admin/rewards/restrict — flag (or clear) a member for reward fraud
 * (rewards brief §11, §14). While restricted: no new rewards, no qualification,
 * no withdrawal requests. Past rewards stay as they were — nothing is rewritten.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give an email and whether to restrict." }, { status: 400 });
  const { data } = await createAdminClient().from("profiles").select("id").ilike("email", parsed.data.email).maybeSingle();
  const userId = (data as { id?: string } | null)?.id;
  if (!userId) return NextResponse.json({ error: "No account with that email." }, { status: 404 });
  const ok = await setRewardRestriction(userId, parsed.data.restricted, parsed.data.reason ?? null, admin.id);
  if (!ok) return NextResponse.json({ error: "Couldn't update it." }, { status: 503 });
  console.info("[admin/rewards] restriction", { admin: admin.id, userId, restricted: parsed.data.restricted });
  return NextResponse.json({ ok: true });
}
