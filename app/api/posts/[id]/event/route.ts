import { NextResponse } from "next/server";
import { z } from "zod";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_KINDS = ["copy_link", "os_share", "email", "sms", "qr"] as const;
const schema = z.object({
  type: z.enum(["download", "share"]),
  // Part 6 tranche 3 — which external destination, for share_events'
  // breakdown. Optional: older clients / the download event never send it.
  kind: z.enum(EXTERNAL_KINDS).optional(),
});

/**
 * POST /api/posts/:id/event — increments the download/share counter. Beacon-
 * style, rate-limited to resist inflation. Counted via a whitelisted SQL fn.
 *
 * Anonymous-friendly (no auth required) — the counter bump always happens.
 * The share_events LEDGER write is signed-in only (the table's sharer_id is
 * `not null`): an anonymous copy-link tap still bumps the public count, it
 * just doesn't appear in anyone's Share Journey breakdown. DM/group shares
 * are ledgered separately by /api/posts/[id]/share, which already knows the
 * real recipients — this route only ever logs the external kinds above.
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

  const db = createAdminClient();
  try {
    await db.rpc("bump_post_counter", { p_id: id, p_kind: parsed.data.type });
  } catch {
    /* best-effort */
  }

  if (parsed.data.type === "share" && parsed.data.kind) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: post } = await db.from("posts").select("publisher_id").eq("id", id).maybeSingle();
        if (post) {
          void db
            .from("share_events")
            .insert({ sharer_id: user.id, post_id: id, creator_id: post.publisher_id, recipient_count: 0, kind: parsed.data.kind })
            .then(
              () => {},
              () => {},
            );
        }
      }
    } catch {
      /* best-effort — the raw counter above already recorded the share */
    }
  }

  return NextResponse.json({ ok: true });
}
