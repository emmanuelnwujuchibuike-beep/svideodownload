import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const vis = z.enum(["public", "followers", "private"]);
const policy = z.enum(["everyone", "followers", "off"]);
const relPolicy = z.enum(["everyone", "friends", "nobody"]);

const schema = z.object({
  activity_visibility: vis.optional(),
  followers_visibility: vis.optional(),
  reposts_visibility: vis.optional(),
  likes_visibility: vis.optional(),
  saves_visibility: vis.optional(),
  comments_policy: policy.optional(),
  messages_policy: policy.optional(),
  allow_indexing: z.boolean().optional(),
  show_in_recommendations: z.boolean().optional(),
  // Part 11b
  read_receipts_enabled: z.boolean().optional(),
  typing_indicators_enabled: z.boolean().optional(),
  last_seen_visibility: relPolicy.optional(),
  group_invite_policy: relPolicy.optional(),
});

/** PATCH /api/privacy — upsert the signed-in user's privacy settings. */
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
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid privacy settings." }, { status: 400 });
  }

  const { error } = await supabase
    .from("privacy_settings")
    .upsert(
      { user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/privacy — the signed-in user's own privacy settings.
 *
 * Added for the presence picker's "Hide my last seen" switch: a control that
 * shows its own state has to be able to READ that state, and this route was
 * PATCH-only (the settings page gets its copy server-side, so nothing had needed
 * a client read before).
 *
 * Defaults mirror getPrivacySettings' — a user who has never opened Privacy has
 * no row at all, which is not an error and must read as the defaults, not as
 * "hidden".
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await supabase
    .from("privacy_settings")
    .select("last_seen_visibility, read_receipts_enabled, typing_indicators_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    last_seen_visibility: (data?.last_seen_visibility as string) ?? "everyone",
    read_receipts_enabled: (data?.read_receipts_enabled as boolean) ?? true,
    typing_indicators_enabled: (data?.typing_indicators_enabled as boolean) ?? true,
  });
}
