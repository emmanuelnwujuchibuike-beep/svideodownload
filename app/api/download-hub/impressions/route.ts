import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { GATEWAY_ACTIONS } from "@/lib/download-hub/actions";
import { recordImpressions } from "@/lib/download-hub/record";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set(GATEWAY_ACTIONS.map((a) => a.id));

/**
 * Records which Discovery Gateway™ recommendations were shown. The denominator
 * for acceptance rate.
 *
 * Action ids are validated against the catalogue rather than accepted as free
 * text — this endpoint is unauthenticated by design (anonymous visitors are the
 * Gateway's most valuable audience), so without that check it would be an open
 * write of arbitrary strings into an admin-facing table.
 */
const bodySchema = z.object({
  actionIds: z.array(z.string().max(64)).max(12),
  platformId: z.string().max(32).default(""),
  kind: z.string().max(16).default(""),
});

export async function POST(request: Request) {
  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: true });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const actionIds = parsed.data.actionIds.filter((id) => VALID_ACTIONS.has(id));
  if (actionIds.length === 0) return NextResponse.json({ ok: true });

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous — expected and supported */
  }

  // after(): the insert must finish even though we respond immediately. A bare
  // void isn't guaranteed to run to completion on Vercel.
  after(() =>
    recordImpressions(actionIds, { platformId: parsed.data.platformId, kind: parsed.data.kind }, userId),
  );

  return NextResponse.json({ ok: true });
}
