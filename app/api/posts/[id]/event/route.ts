import { NextResponse } from "next/server";
import { z } from "zod";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ type: z.enum(["download", "share"]) });

/**
 * POST /api/posts/:id/event — increments the download/share counter. Beacon-
 * style, rate-limited to resist inflation. Counted via a whitelisted SQL fn.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    await createAdminClient().rpc("bump_post_counter", { p_id: id, p_kind: parsed.data.type });
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
