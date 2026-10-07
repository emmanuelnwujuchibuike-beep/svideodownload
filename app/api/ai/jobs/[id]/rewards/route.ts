import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_FEATURES = new Set(["ai_text_to_video", "ai_image_to_video", "ai_lip_sync"]);

/**
 * GET /api/ai/jobs/[id]/rewards — what the result card may say about rewards
 * for one of the member's own finished AI videos (owner brief 2026-10-07 §5–§6):
 *
 *   generation  the credits this generation EARNED (a granted reward row), or null
 *   share       the credits publishing it to AI Reels earned, or null
 *   postId      the AI Reel it is published as, or null
 *   shareOffer  the share reward the card may mention — only when the operator's
 *               rule is on, the video is long enough (the SERVER's measured
 *               duration) and it has not been rewarded yet; otherwise null
 *
 * Read only from the database — never promised before the engine granted it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`ai-job-rewards:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const db = createAdminClient();
  const [job, events, post, settings] = await Promise.all([
    db.from("ai_jobs").select("user_id, feature, status, result_duration").eq("id", id).maybeSingle(),
    db.from("reward_events").select("event_type, amount").eq("beneficiary_id", user.id).eq("role", "actor").eq("source_type", "ai_job").eq("source_id", id).in("event_type", ["ai_video_completed", "ai_video_shared"]),
    db.from("posts").select("id").eq("ai_job_id", id).maybeSingle(),
    getLandingSettings(),
  ]);
  const j = job.data as { user_id: string | null; feature: string; status: string; result_duration: number | string | null } | null;
  if (!j || j.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const rows = (events.data ?? []) as { event_type: string; amount: number }[];
  const generation = rows.find((r) => r.event_type === "ai_video_completed") ?? null;
  const share = rows.find((r) => r.event_type === "ai_video_shared") ?? null;
  const rules = settings.frenzRewards;
  const rule = rules.events.ai_video_shared;
  const minSeconds = rule.minDurationSeconds ?? 30;
  const duration = j.result_duration === null ? null : Number(j.result_duration);
  const eligible = rules.enabled && rule.enabled && rule.actorCredits > 0 && VIDEO_FEATURES.has(j.feature) && j.status === "completed" && duration !== null && Number.isFinite(duration) && duration >= minSeconds - 0.05;

  return NextResponse.json(
    {
      generation: generation ? { credits: generation.amount } : null,
      share: share ? { credits: share.amount } : null,
      postId: (post.data as { id?: string } | null)?.id ?? null,
      shareOffer: eligible && !share ? { credits: rule.actorCredits, minSeconds } : null,
      minShareSeconds: rule.enabled ? minSeconds : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
