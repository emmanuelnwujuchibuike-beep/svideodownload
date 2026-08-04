import { NextResponse } from "next/server";
import { z } from "zod";

import { isSearchField, optionalFieldKeys } from "@/lib/discovery/fields";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/discovery/settings — the member's own discoverability (0113).
 *
 * Only OPTIONAL fields may be sent. Handle and display name are structural:
 * a profile that cannot be found by the name it is addressed by is a hidden
 * account, which is a different control (`is_hidden`) that already exists and
 * carries different consequences. Accepting them here would give two switches
 * for one behaviour and let the weaker one appear to do the stronger thing.
 */
const schema = z.object({
  discoverable: z.boolean().optional(),
  fields: z.array(z.string().max(32)).max(16).optional(),
  directoryListed: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings." }, { status: 400 });

  const row: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if (parsed.data.discoverable !== undefined) row.discoverable = parsed.data.discoverable;
  if (parsed.data.directoryListed !== undefined) row.directory_listed = parsed.data.directoryListed;
  if (parsed.data.fields !== undefined) {
    const allowed = new Set(optionalFieldKeys());
    // Unknown or required keys are dropped rather than rejected — a stale tab
    // sending an old field name should still save the rest.
    row.search_fields = [...new Set(parsed.data.fields.filter((f) => isSearchField(f) && allowed.has(f)))];
  }

  try {
    const { error } = await createAdminClient().from("profile_discovery").upsert(row, { onConflict: "user_id" });
    if (error) {
      return NextResponse.json(
        { error: "Discovery settings aren't available yet. Ask an admin to apply the latest database update." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}
