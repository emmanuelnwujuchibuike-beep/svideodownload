import { after, NextResponse } from "next/server";
import { z } from "zod";

import { scoreReportedTarget } from "@/lib/moderation/risk-score";
import { sendPushToUser } from "@/lib/push/web-push";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  // sub_post / sub_comment (0247): exclusive content, checked and filed by lib/sub/moderation.ts
  targetType: z.enum(["post", "comment", "user", "sub_post", "sub_comment"]),
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

  /*
    Exclusive content (Frenz Exclusive Part 2): the target must exist and be something this
    person can actually see (a published post's tile; a comment only if they can read it),
    and the answer carries nothing about the content. No auto-hide threshold and no AI
    scoring of paid content here: an admin reviews every exclusive report.
  */
  if (parsed.data.targetType === "sub_post" || parsed.data.targetType === "sub_comment") {
    const { success: perUser } = await trackLimiter.limit(`report-sub:${user.id}`);
    if (!perUser) return NextResponse.json({ error: "Too many reports." }, { status: 429 });
    const { reportSubTarget } = await import("@/lib/sub/moderation");
    const out = await reportSubTarget(user.id, parsed.data.targetType, parsed.data.targetId, parsed.data.reason, parsed.data.note ?? null);
    return out.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: out.error }, { status: out.status });
  }

  // exclusive content returned above: from here on it is a post, comment or account
  const targetType = parsed.data.targetType;

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

  // Part 11c — moderation pipeline: risk-score the target's TEXT once it's
  // actually hidden by the report-threshold trigger, so the admin queue
  // shows an AI-assisted starting point instead of raw text cold. Only
  // "user" reports are skipped (an account has no single text blob to
  // classify). Scored once per target (skips if an assessment already
  // exists) — later reports on the same already-hidden item don't re-spend
  // an API call for no new information.
  if (!error && (parsed.data.targetType === "post" || parsed.data.targetType === "comment")) {
    after(async () => {
      try {
        const admin = createAdminClient();
        const { data: existing } = await admin
          .from("moderation_ai_assessments")
          .select("target_type")
          .eq("target_type", parsed.data.targetType)
          .eq("target_id", parsed.data.targetId)
          .maybeSingle();
        if (existing) return;

        let content = "";
        if (parsed.data.targetType === "post") {
          const { data: post } = await admin.from("posts").select("status, title, description").eq("id", parsed.data.targetId).maybeSingle();
          if (post?.status !== "under_review") return;
          content = [post.title, post.description].filter(Boolean).join("\n");
        } else {
          const { data: comment } = await admin.from("post_comments").select("status, body").eq("id", parsed.data.targetId).maybeSingle();
          if (comment?.status !== "hidden") return;
          content = (comment.body as string) ?? "";
        }

        const { data: openReports } = await admin
          .from("reports")
          .select("reason")
          .eq("target_type", parsed.data.targetType)
          .eq("target_id", parsed.data.targetId)
          .eq("status", "open");
        const reasons = [...new Set(((openReports ?? []) as { reason: string }[]).map((r) => r.reason))];

        await scoreReportedTarget(targetType, parsed.data.targetId, content, reasons);
      } catch {
        /* best-effort — the queue just shows no assessment for this target */
      }
    });
  }

  return NextResponse.json({ ok: true });
}
