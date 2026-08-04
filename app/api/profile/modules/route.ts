import { NextResponse } from "next/server";
import { z } from "zod";

import { canEnableModule } from "@/lib/profile/engine";
import { AUDIENCE_KEYS, LIVE_MODULE_KEYS } from "@/lib/profile/modules";
import { profileType } from "@/lib/profile/profile-types";
import { circleAudienceId } from "@/lib/social/graph/circles";
import { ownedCircleIds } from "@/lib/social/graph/store";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Smart Profile Modules™ — the member's module layout (migration 0107).
 *
 * PUT replaces the whole layout in one write, because that is what the screen
 * actually edits: reordering is a property of the LIST, not of a row, so
 * patching one module at a time would let two positions collide.
 */

const schema = z.object({
  modules: z
    .array(
      z.object({
        key: z.enum(LIVE_MODULE_KEYS),
        enabled: z.boolean(),
        // A built-in key, or a Part 17 `circle:<uuid>` whose ownership is
        // checked below — a member may only gate a section to a circle they
        // actually own, or they could point it at a stranger's circle and hand
        // that stranger's friends the keys to their private section.
        audience: z.union([z.enum(AUDIENCE_KEYS), z.string().max(64)]),
      }),
    )
    .max(40),
});

export async function PUT(request: Request) {
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
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid layout." }, { status: 400 });
  }

  // The member's CURRENT type decides which modules they may enable — the
  // client's idea of it is not trusted. A stale tab that still thinks this is a
  // Business profile cannot enable a catalog on a personal one.
  const { data: row, error: typeError } = await supabase
    .from("profiles")
    .select("profile_type")
    .eq("id", user.id)
    .maybeSingle();
  if (typeError) {
    return NextResponse.json(
      { error: "Profile modules aren't available yet. Ask an admin to apply the latest database update." },
      { status: 503 },
    );
  }
  const type = profileType((row as { profile_type: string | null } | null)?.profile_type).key;

  // Circles this member owns. Anything else in a `circle:` audience is
  // rewritten to `private` rather than rejected: the section stays hidden
  // (the safe direction) instead of the whole save failing on one stale chip.
  const ownCircles = await ownedCircleIds(user.id);
  const audienceFor = (raw: string): string => {
    if ((AUDIENCE_KEYS as readonly string[]).includes(raw)) return raw;
    const circleId = circleAudienceId(raw);
    if (circleId && ownCircles.has(circleId)) return raw;
    return "private";
  };

  const seen = new Set<string>();
  const rows = parsed.data.modules
    .filter((m) => {
      if (seen.has(m.key)) return false; // one row per module, whatever was sent
      seen.add(m.key);
      return canEnableModule(type, m.key);
    })
    .map((m, index) => ({
      user_id: user.id,
      module_key: m.key,
      enabled: m.enabled,
      // Position comes from the ORDER of the array, never from the client's
      // own numbering — so positions are always dense and never collide.
      position: index,
      audience: audienceFor(m.audience),
      updated_at: new Date().toISOString(),
    }));

  const { error } = await supabase.from("profile_modules").upsert(rows, { onConflict: "user_id,module_key" });
  if (error) {
    return NextResponse.json(
      { error: "Profile modules aren't available yet. Ask an admin to apply the latest database update." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}
