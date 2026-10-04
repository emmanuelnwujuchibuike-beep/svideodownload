import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO SAW IT — and who took a picture of it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   POST  /api/stories/:id/views            record that I watched it
 *   POST  /api/stories/:id/views?shot=1     record that I screenshotted it
 *   GET   /api/stories/:id/views            the author's own viewer list
 *
 * ── 🔴 THE RECIPROCITY RULE (migration 0181) ───────────────────────────────
 *
 * Owner: "when they turn it off, them and users who see when they screenshot
 * their post." Turning the switch off is not one-directional. A member with it
 * off stops seeing who screenshotted their stories AND stops being reported for
 * screenshotting anyone else's.
 *
 * Enforced at WRITE time, from the screenshotter's own settings row — never at
 * read time. A read-time filter would record the screenshot anyway and merely
 * decline to render it, which is not the promise the switch makes.
 *
 * The GET then applies the author's own half: with THEIR switch off, the list
 * comes back with every `screenshotted` flag false. They opted out of the
 * exchange, so they do not get the half that benefits them.
 */

/** Both halves of the rule read this. Defaults TRUE, and a missing column (migration not yet applied) is also TRUE. */
async function screenshotAlertsOn(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("privacy_settings").select("story_screenshot_alerts").eq("user_id", userId).maybeSingle();
  if (error) return true;
  const value = (data as { story_screenshot_alerts?: boolean } | null)?.story_screenshot_alerts;
  return value !== false;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A signed-out visitor watching a story is not an error — there is simply
  // nobody to record. Answering 200 keeps the client's fire-and-forget quiet.
  if (!user) return NextResponse.json({ ok: true, recorded: false });

  const shot = new URL(request.url).searchParams.get("shot") === "1";
  const admin = createAdminClient();

  try {
    const { data: story } = await admin.from("stories").select("id, user_id").eq("id", id).maybeSingle();
    if (!story) return NextResponse.json({ ok: true, recorded: false });
    // Watching your own story is not a view, and screenshotting it is not news.
    if ((story.user_id as string) === user.id) return NextResponse.json({ ok: true, recorded: false });

    if (shot) {
      /*
        🔴 The rule. With the switch off nothing is written — not a flag that is
        later hidden, not a row the author cannot read. There is no record.
      */
      if (!(await screenshotAlertsOn(admin, user.id))) return NextResponse.json({ ok: true, recorded: false, reason: "alerts-off" });
      await admin
        .from("story_views")
        .upsert(
          { story_id: id, viewer_id: user.id, screenshot_at: new Date().toISOString() },
          { onConflict: "story_id,viewer_id" },
        );
      return NextResponse.json({ ok: true, recorded: true });
    }

    /*
      A plain view. `ignoreDuplicates` so re-watching does not keep moving
      `viewed_at` — the author cares when somebody FIRST saw it — and, more
      importantly, so a second view cannot wipe a `screenshot_at` already on the
      row by overwriting it with a default.
    */
    await admin
      .from("story_views")
      .upsert({ story_id: id, viewer_id: user.id }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
    return NextResponse.json({ ok: true, recorded: true });
  } catch {
    // A view that failed to record must never surface to somebody watching a story.
    return NextResponse.json({ ok: true, recorded: false });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const { data: story } = await admin.from("stories").select("id, user_id").eq("id", id).maybeSingle();
  if (!story) return NextResponse.json({ error: "That story is gone." }, { status: 404 });
  // The viewer list is the author's information. The RLS policy says the same;
  // this says it before a query runs, with a sentence instead of an empty array.
  if ((story.user_id as string) !== user.id) return NextResponse.json({ error: "Not yours." }, { status: 403 });

  const { data, error } = await admin
    .from("story_views")
    .select("viewer_id, viewed_at, screenshot_at")
    .eq("story_id", id)
    .order("viewed_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Couldn't load viewers." }, { status: 500 });

  const rows = data ?? [];
  const ids = rows.map((r) => r.viewer_id as string);
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  // The author's own half of the rule: opted out, so the screenshot column is
  // withheld from them too. The rows still exist; this is what they bought.
  const authorSeesShots = await screenshotAlertsOn(admin, user.id);

  return NextResponse.json({
    screenshotAlerts: authorSeesShots,
    viewers: rows.map((r) => {
      const p = byId.get(r.viewer_id as string);
      return {
        id: r.viewer_id as string,
        handle: (p?.handle as string | null) ?? null,
        displayName: (p?.display_name as string | null) ?? null,
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        viewedAt: r.viewed_at as string,
        screenshotted: authorSeesShots ? !!r.screenshot_at : false,
      };
    }),
  });
}
