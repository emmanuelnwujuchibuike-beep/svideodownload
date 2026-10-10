import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CIRCLE_COLORS,
  CIRCLE_ICONS,
  CIRCLE_KINDS,
  DEFAULT_CIRCLE_COLOR,
  DEFAULT_CIRCLE_ICON,
  PREMIUM_CIRCLE_COLORS,
  type CircleColor,
  MAX_CIRCLES_PER_MEMBER,
  validateCircleName,
} from "@/lib/social/graph/circles";
import { listCircles } from "@/lib/social/graph/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Social Circles — list and create (migration 0112).
 *
 * Every route in this folder derives the owner from the SESSION and never from
 * the body. There is no `ownerId` parameter anywhere, because a circle API that
 * accepts one is one missing check away from letting anyone read or edit
 * someone else's private groupings.
 */

const createSchema = z.object({
  // a special circle (Feature 19 · Part 4) brings its own name, so `name` is optional with a kind
  name: z.string().min(1).max(64).optional(),
  color: z.enum(CIRCLE_COLORS as unknown as [string, ...string[]]).optional(),
  icon: z.enum(CIRCLE_ICONS).optional(),
  kind: z.enum(["close_friends", "inner_circle", "vip"]).optional(),
});
const NEEDS_0217 = "That option arrives with the latest database update. Ask an admin to apply it.";

const NOT_MIGRATED = "Circles aren't available yet. Ask an admin to apply the latest database update.";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  return NextResponse.json({ circles: await listCircles(user.id) });
}

export async function POST(request: Request) {
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.name && !parsed.data.kind)) return NextResponse.json({ error: "Give the circle a name." }, { status: 400 });
  const special = parsed.data.kind ? CIRCLE_KINDS[parsed.data.kind] : null;

  const existing = await listCircles(user.id);
  if (existing.length >= MAX_CIRCLES_PER_MEMBER) {
    return NextResponse.json({ error: `You can have up to ${MAX_CIRCLES_PER_MEMBER} circles.` }, { status: 400 });
  }

  // Name rules live in the pure module so the API and the UI cannot disagree
  // about what is allowed.
  if (parsed.data.kind && existing.some((c) => c.kind === parsed.data.kind)) {
    return NextResponse.json({ error: `You already have ${special!.name}.` }, { status: 400 });
  }
  const name = validateCircleName(
    special?.name ?? parsed.data.name ?? "",
    existing.map((c) => c.name),
  );
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

  const color = (parsed.data.color ?? special?.color ?? DEFAULT_CIRCLE_COLOR) as CircleColor;
  const icon = parsed.data.icon ?? special?.icon ?? DEFAULT_CIRCLE_ICON;
  const kind = parsed.data.kind ?? "custom";
  // needs 0217 (kind, icon, the premium palette) — anything else is the original insert
  const needs0217 = kind !== "custom" || icon !== DEFAULT_CIRCLE_ICON || PREMIUM_CIRCLE_COLORS.has(color);
  try {
    const db = createAdminClient();
    let { data, error } = await db
      .from("social_circles")
      .insert({ owner_id: user.id, name: name.value, color, position: existing.length, kind, icon })
      .select("id, name, color, position")
      .single();
    if (error && !needs0217) {
      ({ data, error } = await db
        .from("social_circles")
        .insert({ owner_id: user.id, name: name.value, color, position: existing.length })
        .select("id, name, color, position")
        .single());
    }
    if (error || !data) return NextResponse.json({ error: needs0217 ? NEEDS_0217 : NOT_MIGRATED }, { status: 503 });
    return NextResponse.json({
      circle: {
        id: (data as { id: string }).id,
        name: (data as { name: string }).name,
        color: (data as { color: string }).color,
        position: (data as { position: number }).position,
        memberCount: 0,
        kind,
        icon,
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't create that circle." }, { status: 500 });
  }
}
