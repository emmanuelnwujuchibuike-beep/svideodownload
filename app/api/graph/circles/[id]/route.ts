import { NextResponse } from "next/server";
import { z } from "zod";

import { CIRCLE_COLORS, validateCircleName } from "@/lib/social/graph/circles";
import { listCircles } from "@/lib/social/graph/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: z.enum(CIRCLE_COLORS as unknown as [string, ...string[]]).optional(),
});

/**
 * PATCH — rename or recolour. DELETE — remove the circle.
 *
 * Both scope the write with `.eq("owner_id", user.id)` even though the id is a
 * uuid. Guessing a uuid is impractical, but "impractical to guess" is not an
 * authorisation check, and the admin client bypasses RLS — so the ownership
 * predicate has to be in the query itself.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (parsed.data.name !== undefined) {
    const others = (await listCircles(user.id)).filter((c) => c.id !== id).map((c) => c.name);
    const name = validateCircleName(parsed.data.name, others);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    patch.name = name.value;
  }
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;

  try {
    const { error } = await createAdminClient()
      .from("social_circles")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't update that circle." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't update that circle." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    // Membership rows go with it via ON DELETE CASCADE. Any profile module
    // still gated to this circle becomes an unresolvable `circle:<uuid>`, which
    // `canSeeModule` treats as invisible-to-everyone-but-the-owner — the safe
    // direction, and the owner sees it in Modules with a "circle deleted" state
    // rather than the section silently becoming public.
    const { error } = await createAdminClient()
      .from("social_circles")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't delete that circle." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't delete that circle." }, { status: 500 });
  }
}
