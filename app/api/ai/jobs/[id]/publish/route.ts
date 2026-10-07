import { NextResponse } from "next/server";
import { z } from "zod";

import { publishAiReel } from "@/lib/ai/reels/publish";
import { metadataLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ caption: z.string().trim().max(2000).nullable().optional(), visibility: z.enum(["public", "followers", "private"]).optional() }).strict();

/**
 * POST /api/ai/jobs/[id]/publish — share a finished Frenz AI video to Reels
 * (rewards brief §4–§5). The member is the session's; everything about the
 * video — that Frenz AI made it, that it is theirs, that it finished, how long
 * it is — is read from the job on the server (lib/ai/reels/publish.ts). The
 * body may carry a caption and a visibility, nothing else. The +3 is decided by
 * the reward engine, once per video.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to publish." }, { status: 401 });
  const burst = await metadataLimiter.limit(`ai-publish:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too fast — slow down." }, { status: 429 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* an empty body is a publish with no caption */
  }
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await publishAiReel({ userId: user.id, jobId: id, caption: parsed.data.caption ?? null, visibility: parsed.data.visibility ?? "public" });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  const shareReward = out.rewards.find((r) => r.event === "ai_video_shared" && r.role === "actor") ?? null;
  return NextResponse.json({ ok: true, postId: out.postId, url: `/p/${out.postId}`, created: out.created, reward: shareReward ? { credits: shareReward.amount, creditClass: shareReward.credit_class } : null });
}
