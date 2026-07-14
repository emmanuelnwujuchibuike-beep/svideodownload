import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ["messaging", "status", "calls"] as const;
type RestrictionScope = (typeof SCOPES)[number];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Body is optional — `{}`/omitted keeps the original full-block behavior. */
async function readScope(req: Request): Promise<RestrictionScope | "all" | null> {
  try {
    const body = (await req.json()) as { scope?: string };
    if (!body?.scope || body.scope === "all") return "all";
    return (SCOPES as readonly string[]).includes(body.scope) ? (body.scope as RestrictionScope) : null;
  } catch {
    return "all"; // no/empty body — the pre-existing full-block call shape
  }
}

/**
 * POST /api/block/:id — `{ scope: "messaging" | "status" | "calls" }` adds
 * ONE granular restriction (`user_restrictions`, migration 0076) without a
 * full block. Omitted/`"all"` is the original full block: also removes any
 * follow edges in BOTH directions (a block severs the relationship). Done
 * with the service role so the other user's edge can be cleared too.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) return NextResponse.json({ error: "You can't block yourself." }, { status: 400 });

  const scope = await readScope(req);
  if (scope === null) return NextResponse.json({ error: "Bad scope." }, { status: 400 });

  try {
    const db = createAdminClient();
    if (scope !== "all") {
      await db.from("user_restrictions").upsert(
        { restrictor_id: user.id, restricted_id: id, scope },
        { onConflict: "restrictor_id,restricted_id,scope" },
      );
      return NextResponse.json({ ok: true, restricted: scope });
    }
    await db.from("blocks").upsert(
      { blocker_id: user.id, blocked_id: id },
      { onConflict: "blocker_id,blocked_id" },
    );
    // Sever follows both ways (trigger keeps the counts correct).
    await db
      .from("follows")
      .delete()
      .or(
        `and(follower_id.eq.${user.id},following_id.eq.${id}),and(follower_id.eq.${id},following_id.eq.${user.id})`,
      );
    return NextResponse.json({ ok: true, blocked: true });
  } catch {
    return NextResponse.json({ error: "Couldn't block." }, { status: 500 });
  }
}

/** DELETE /api/block/:id — `{ scope }` removes one restriction; omitted/`"all"` unblocks fully. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const scope = await readScope(req);
  if (scope === null) return NextResponse.json({ error: "Bad scope." }, { status: 400 });

  try {
    const db = createAdminClient();
    if (scope !== "all") {
      await db.from("user_restrictions").delete().eq("restrictor_id", user.id).eq("restricted_id", id).eq("scope", scope);
      return NextResponse.json({ ok: true, restricted: false, scope });
    }
    await db.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", id);
    return NextResponse.json({ ok: true, blocked: false });
  } catch {
    return NextResponse.json({ error: "Couldn't unblock." }, { status: 500 });
  }
}

/**
 * GET /api/block/:id — current restriction state, for the chat options
 * sheet. `blocked`/`messaging`/`status`/`calls` are the VIEWER's OWN choices
 * (drives the sheet's toggle states). `callsUnavailable` is a separate,
 * bidirectional check (either party blocked, or either party restricted
 * `calls`) — used by ThreadHeader to hide the voice/video placeholder
 * buttons, since a restriction either person has set should hide them for
 * both, not just reflect the viewer's own toggle.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    const db = createAdminClient();
    const [{ data: blockRow }, { data: restrictionRows }, { count: eitherBlocked }, { count: eitherCallsRestricted }] = await Promise.all([
      db.from("blocks").select("blocker_id").eq("blocker_id", user.id).eq("blocked_id", id).maybeSingle(),
      db.from("user_restrictions").select("scope").eq("restrictor_id", user.id).eq("restricted_id", id),
      db
        .from("blocks")
        .select("blocker_id", { head: true, count: "exact" })
        .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${id}),and(blocker_id.eq.${id},blocked_id.eq.${user.id})`),
      db
        .from("user_restrictions")
        .select("restrictor_id", { head: true, count: "exact" })
        .eq("scope", "calls")
        .or(`and(restrictor_id.eq.${user.id},restricted_id.eq.${id}),and(restrictor_id.eq.${id},restricted_id.eq.${user.id})`),
    ]);
    const scopes = new Set((restrictionRows ?? []).map((r) => r.scope as RestrictionScope));
    return NextResponse.json({
      blocked: !!blockRow,
      messaging: scopes.has("messaging"),
      status: scopes.has("status"),
      calls: scopes.has("calls"),
      callsUnavailable: (eitherBlocked ?? 0) > 0 || (eitherCallsRestricted ?? 0) > 0,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't load." }, { status: 500 });
  }
}
