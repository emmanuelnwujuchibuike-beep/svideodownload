import { NextResponse } from "next/server";
import { z } from "zod";

import { canApplyLabel, resolveLabelInput } from "@/lib/social/graph/labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  subjectId: z.string().regex(UUID),
  /** A built-in key, a custom string, or null to clear. */
  label: z.string().max(64).nullable(),
  note: z.string().max(280).nullable().optional(),
});

/**
 * PUT /api/graph/labels — set or clear your private label for someone.
 *
 * There is NO GET for a single subject by anyone but the owner, and no route at
 * all that answers "who has labelled me". A label is the labeller's private
 * note; the subject is never told, and the absence of a read path is part of
 * how that stays true.
 */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid label." }, { status: 400 });

  const { subjectId, note } = parsed.data;
  if (subjectId === user.id) return NextResponse.json({ error: "You can't label yourself." }, { status: 400 });

  const db = createAdminClient();

  const resolved = resolveLabelInput(parsed.data.label);
  if (resolved && "error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // Clearing.
  if (resolved === null) {
    try {
      await db.from("relationship_labels").delete().eq("owner_id", user.id).eq("subject_id", subjectId);
      return NextResponse.json({ ok: true, label: null });
    } catch {
      return NextResponse.json({ error: "Couldn't clear that." }, { status: 500 });
    }
  }

  const value = resolved.kind === "builtin" ? resolved.key : resolved.value;

  // Labels claiming closeness need a real, mutual friendship behind them —
  // otherwise a one-way follow gets privately reframed as intimacy and then
  // feeds the reconnect prompts and the connection map as if both people were
  // in it.
  if (!canApplyLabel(value, { isFriend: await areFriends(user.id, subjectId) })) {
    return NextResponse.json({ error: "You can only use that label with a friend." }, { status: 400 });
  }

  try {
    const { error } = await db.from("relationship_labels").upsert(
      {
        owner_id: user.id,
        subject_id: subjectId,
        label: value,
        note: note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,subject_id" },
    );
    if (error) {
      return NextResponse.json(
        { error: "Labels aren't available yet. Ask an admin to apply the latest database update." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, label: value });
  } catch {
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}

/** Fails closed — an unproven friendship is not a friendship. */
async function areFriends(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  try {
    const { data } = await createAdminClient()
      .from("friendships")
      .select("user_low")
      .eq("user_low", low)
      .eq("user_high", high)
      .limit(1);
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
