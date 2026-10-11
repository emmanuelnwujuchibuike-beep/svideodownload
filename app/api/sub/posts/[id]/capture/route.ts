import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { CAPTURE_KINDS, reportSubCapture } from "@/lib/sub/capture";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const body = z.object({ kind: z.enum(CAPTURE_KINDS) }).strict();

/** POST — the private viewer saw a screenshot shortcut. Tells the creator (push + a card with Block / Ignore). See lib/sub/capture.ts for what can and cannot be detected. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-capture:${user.id}`);
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const out = await reportSubCapture(id, user.id, parsed.data.kind);
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
