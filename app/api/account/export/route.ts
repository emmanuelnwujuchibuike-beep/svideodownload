import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — Privacy Dashboard's "Download my data." Scoped
 * to data this account fully owns: profile, own posts/comments, follow
 * graph, blocked/muted lists, privacy settings, and own security activity.
 * Deliberately excludes messages/conversations — those involve OTHER
 * people's content too (and Secret Chats are E2EE, undecryptable server-
 * side by design), so a partial/wrong export there would be worse than none.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  const [profile, posts, comments, following, followers, blocks, muted, privacy, auditLog] = await Promise.all([
    db.from("profiles").select("id, handle, display_name, bio, created_at").eq("id", user.id).maybeSingle(),
    db.from("posts").select("id, title, media_kind, status, visibility, views_count, likes_count, created_at").eq("publisher_id", user.id),
    db.from("post_comments").select("id, post_id, body, status, created_at").eq("author_id", user.id),
    db.from("follows").select("following_id, created_at").eq("follower_id", user.id),
    db.from("follows").select("follower_id, created_at").eq("following_id", user.id),
    db.from("blocks").select("blocked_id, created_at").eq("blocker_id", user.id),
    db.from("muted_creators").select("muted_id, created_at").eq("muter_id", user.id),
    db.from("privacy_settings").select("*").eq("user_id", user.id).maybeSingle(),
    db.from("security_audit_log").select("event_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    profile: profile.data ?? null,
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    following: following.data ?? [],
    followers: followers.data ?? [],
    blockedAccounts: blocks.data ?? [],
    mutedAccounts: muted.data ?? [],
    privacySettings: privacy.data ?? null,
    securityActivity: auditLog.data ?? [],
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="frenz-data-export-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
