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
  // Migrations 0102 + 0106 — public-by-default, hideable.
  show_reputation: z.boolean().optional(),
  show_plan_badge: z.boolean().optional(),
  show_views: z.boolean().optional(),
  // Migration 0112 — relationship privacy (Part 17).
  friends_visibility: z.enum(["public", "friends", "private"]).optional(),
  following_visibility: vis.optional(),
  show_mutual_connections: z.boolean().optional(),
  // Migration 0122 — comment keyword filter (Feature 15 Part 5 tranche 4).
  muted_comment_keywords: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
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

  const row = { user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("privacy_settings").upsert(row, { onConflict: "user_id" });
  if (error) {
    // The migration-0102/0106/0112 columns may not be applied yet — retry WITHOUT
    // them so every other privacy setting still saves (these toggles then persist
    // once the migrations land).
    const {
      show_reputation: _sr,
      show_plan_badge: _spb,
      show_views: _sv,
      friends_visibility: _fv,
      following_visibility: _flv,
      show_mutual_connections: _smc,
      muted_comment_keywords: _mck,
      ...base
    } = row;
    void _sr;
    void _spb;
    void _sv;
    void _fv;
    void _flv;
    void _smc;
    void _mck;
    const retry = await supabase.from("privacy_settings").upsert(base, { onConflict: "user_id" });
    if (retry.error) return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }
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
