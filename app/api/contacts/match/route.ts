import { NextResponse } from "next/server";
import { z } from "zod";

import { contactMatchLimiter } from "@/lib/rate-limit";
import { MATCH_BATCH } from "@/lib/social/contacts/normalize";
import { matchContacts } from "@/lib/social/contacts/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    // SHA-256 hex computed in the browser - an address never reaches this route
    hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(MATCH_BATCH),
    remember: z.boolean().optional(),
  })
  .strict();

/** POST /api/contacts/match — which of my contacts' hashed addresses belong to members who allow it (Feature 19 · Part 5). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const burst = await contactMatchLimiter.limit(`contact-match:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  const out = await matchContacts(supabase, user.id, parsed.data.hashes, parsed.data.remember ?? false);
  const status = out.ok ? 200 : out.reason === "daily_limit" ? 429 : out.reason === "not_ready" ? 503 : out.reason === "error" ? 500 : 400;
  return NextResponse.json(out, { status, headers: { "Cache-Control": "private, no-store" } });
}
