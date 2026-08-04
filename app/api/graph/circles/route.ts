import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CIRCLE_COLORS,
  DEFAULT_CIRCLE_COLOR,
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
  name: z.string().min(1).max(64),
  color: z.enum(CIRCLE_COLORS as unknown as [string, ...string[]]).optional(),
});

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
  if (!parsed.success) return NextResponse.json({ error: "Give the circle a name." }, { status: 400 });

  const existing = await listCircles(user.id);
  if (existing.length >= MAX_CIRCLES_PER_MEMBER) {
    return NextResponse.json({ error: `You can have up to ${MAX_CIRCLES_PER_MEMBER} circles.` }, { status: 400 });
  }

  // Name rules live in the pure module so the API and the UI cannot disagree
  // about what is allowed.
  const name = validateCircleName(
    parsed.data.name,
    existing.map((c) => c.name),
  );
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

  try {
    const { data, error } = await createAdminClient()
      .from("social_circles")
      .insert({
        owner_id: user.id,
        name: name.value,
        color: parsed.data.color ?? DEFAULT_CIRCLE_COLOR,
        position: existing.length,
      })
      .select("id, name, color, position")
      .single();
    if (error || !data) return NextResponse.json({ error: NOT_MIGRATED }, { status: 503 });
    return NextResponse.json({
      circle: {
        id: (data as { id: string }).id,
        name: (data as { name: string }).name,
        color: (data as { color: string }).color,
        position: (data as { position: number }).position,
        memberCount: 0,
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't create that circle." }, { status: 500 });
  }
}
