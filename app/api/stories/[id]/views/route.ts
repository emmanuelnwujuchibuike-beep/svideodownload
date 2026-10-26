import { NextResponse } from "next/server";

import { cacheDelete } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO SAW IT — and who took a picture of it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   POST  /api/stories/:id/views            record that I watched it
 *   POST  /api/stories/:id/views?shot=1     refused since Part 4 — no client can detect a screenshot (see POST)
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
 *
 * ── Stories Part 3 (2026-10-26): what the POST answers ─────────────────────
 *
 *   recorded   true only when the row EXISTS after this call (written now, or
 *              already there). A failed write is false — the client marks a ring
 *              seen only on true (lib/social/story-seen.ts), so a lost request
 *              can never turn a ring grey that the server would show unwatched.
 *   available  false when the story has ended, is gone, or this viewer may no
 *              longer see it (a block, a privacy change) — one flag for all three,
 *              so the answer reveals nothing about WHY. The viewer drops the story
 *              and moves on. A failed access check stays `available: true`: the
 *              rings that offered the story were already authorised, and a
 *              database hiccup must not yank stories from somebody mid-watch.
 */
const GONE = new Set(["missing", "expired", "forbidden"]);

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
  if (!user) return NextResponse.json({ ok: true, recorded: false, available: true });

  const shot = new URL(request.url).searchParams.get("shot") === "1";
  const admin = createAdminClient();

  if (!UUID.test(id)) return NextResponse.json({ ok: true, recorded: false, available: false });

  /*
    🔴 Stories Part 4 (2026-10-26, audit B5): a screenshot is never recorded. No client Frenz ships can DETECT one — a
    browser, the installed web app and the Android app (a web view) are all told nothing by the phone — so a `?shot=1`
    could only ever be somebody's unverified claim about themselves, and the author would read it as fact. Nothing is
    written and nobody is notified. The reciprocity switch (0181) and every saved choice stay as they are; the author's
    list still reads the column, which this keeps empty. Should a native app ever report real screenshots, it gets its
    own verified path — not this one.
  */
  if (shot) return NextResponse.json({ ok: true, recorded: false, available: true, reason: "unsupported" });

  try {
    /*
      🔴 Stories Part 1 (2026-10-26, audit S6). A view is recorded only when this
      viewer may SEE this story right now — the same rules the rings apply
      (`story_view_access`, 0285: blocks and status restrictions both ways, a
      suspended or hidden author, a private profile without a direct chat), and
      never on an ended story. Before this any signed-in member could POST any
      story id and appear in the author's viewer list, a blocked one included.
      Watching your own story is not a view ("self"), and screenshotting it is not news.
    */
    const { data: access, error: accessError } = await admin.rpc("story_view_access", { p_story: id, p_viewer: user.id });
    if (accessError || access !== "ok") return NextResponse.json({ ok: true, recorded: false, available: accessError ? true : !GONE.has(access as string) });

    /*
      A plain view. `ignoreDuplicates` so re-watching does not keep moving
      `viewed_at` — the author cares when somebody FIRST saw it — and, more
      importantly, so a second view cannot wipe a `screenshot_at` already on the
      row by overwriting it with a default.
    */
    const { data: inserted, error: writeError } = await admin
      .from("story_views")
      .upsert({ story_id: id, viewer_id: user.id }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true })
      .select("story_id");
    if (writeError) return NextResponse.json({ ok: true, recorded: false, available: true });
    /*
      A FIRST view changes this viewer's rings (seen, and Part 2's unwatched-first
      order), so their own 20 s ring cache (app/api/stories/route.ts) is dropped — a
      refresh then shows the server's answer, not the copy from before. A repeat
      view inserts nothing (ON CONFLICT DO NOTHING returns no row) and costs nothing.
    */
    if ((inserted ?? []).length > 0) {
      await Promise.all((["all", "friends", "following"] as const).map((s) => cacheDelete(`stories:${user.id}:${s}`))).catch(() => {});
    }
    return NextResponse.json({ ok: true, recorded: true, available: true });
  } catch {
    // A view that failed to record must never surface to somebody watching a story.
    return NextResponse.json({ ok: true, recorded: false, available: true });
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

  /*
    The Story viewer design's "Seen by" (2026-10-26): the three totals are REAL
    counts (truth rule — never a sample number) — viewers from story_views, people
    who reacted from story_reactions (0288), reshares from the stories that name
    this one as their source (0081) — read together. The list itself stays the
    newest 200; the count says how many there are in all.
  */
  const [{ data, error, count }, reactionRead, reshareRead] = await Promise.all([
    admin
      .from("story_views")
      .select("viewer_id, viewed_at, screenshot_at", { count: "exact" })
      .eq("story_id", id)
      .order("viewed_at", { ascending: false })
      .limit(200),
    admin.from("story_reactions").select("reactor_id", { count: "exact" }).eq("story_id", id).limit(1000),
    admin.from("stories").select("id", { count: "exact", head: true }).eq("reshared_from_story_id", id),
  ]);
  if (error) return NextResponse.json({ error: "Couldn't load viewers." }, { status: 500 });
  // 0288 not applied: no reactions yet — null, so the sheet shows a dash, not a made-up 0
  const reacted = new Set(reactionRead.error ? [] : (reactionRead.data ?? []).map((r) => r.reactor_id as string));

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
    totals: {
      viewers: count ?? rows.length,
      reactions: reactionRead.error ? null : (reactionRead.count ?? reacted.size),
      reshares: reshareRead.error ? null : (reshareRead.count ?? 0),
    },
    viewers: rows.map((r) => {
      const p = byId.get(r.viewer_id as string);
      return {
        id: r.viewer_id as string,
        handle: (p?.handle as string | null) ?? null,
        displayName: (p?.display_name as string | null) ?? null,
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        viewedAt: r.viewed_at as string,
        screenshotted: authorSeesShots ? !!r.screenshot_at : false,
        reacted: reacted.has(r.viewer_id as string),
      };
    }),
  });
}
