import { after, NextResponse } from "next/server";
import { z } from "zod";

import { sendPushToUser } from "@/lib/push/web-push";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(1).max(60),
  note: z.string().trim().max(500).optional(),
});

/** POST /api/report — file a moderation report (auth required). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`report:${clientId(request.headers)}`);
  if (!success) return NextResponse.json({ error: "Too many reports." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid report." }, { status: 400 });

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: parsed.data.targetType,
    target_id: parsed.data.targetId,
    reason: parsed.data.reason,
    note: parsed.data.note ?? null,
  });
  // Duplicate (you already reported this) → treat as success.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Couldn't submit report." }, { status: 500 });
  }

  // Best-effort push on top of the in-app notification the
  // auto_moderate_on_report() trigger already inserted (migration 0049) —
  // that trigger fires synchronously as part of the insert above, so by now
  // the post's status update (if any) has already happened in the same
  // transaction. `after()` since this shouldn't hold up the reporter's
  // response, same reasoning as every other push call site.
  if (!error && parsed.data.targetType === "post") {
    after(async () => {
      try {
        const admin = createAdminClient();
        const { data: post } = await admin.from("posts").select("status, publisher_id").eq("id", parsed.data.targetId).maybeSingle();
        if (post?.status !== "under_review") return;
        // Only push if THIS report is (very likely) the one that just
        // crossed the threshold — a post that's been under review for a
        // while shouldn't re-push on every additional report it collects.
        const { data: notif } = await admin
          .from("notifications")
          .select("created_at")
          .eq("post_id", parsed.data.targetId)
          .eq("type", "post_under_review")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!notif || Date.now() - new Date(notif.created_at as string).getTime() > 10_000) return;
        await sendPushToUser(post.publisher_id as string, {
          title: "Your post was hidden pending review",
          body: "One of your posts received multiple reports and is temporarily hidden while we review it.",
          url: `/p/${parsed.data.targetId}`,
          tag: `post-review:${parsed.data.targetId}`,
        });
      } catch {
        /* best-effort */
      }
    });
  }

  return NextResponse.json({ ok: true });
}
