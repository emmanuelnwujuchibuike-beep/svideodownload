import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { VIDEO_STICKER_MAX_MS, videoStickerId } from "@/lib/social/video-stickers";
import { isOwnUpload, storageBasesFromEnv } from "@/lib/storage/owned-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stickers/video — save a video sticker the member just made (0303).
 *
 * The clip (≤3 s, square, silent) and its poster were made in the browser and uploaded to the member's own post-media
 * folders; this only records them. Both URLs must be the member's OWN uploads (a sticker can't point at someone else's
 * file or at another site). The new sticker goes straight into their library. A few per minute.
 */
const schema = z
  .object({
    videoUrl: z.string().url().max(600),
    posterUrl: z.string().url().max(600),
    durationMs: z.number().int().min(200).max(VIDEO_STICKER_MAX_MS),
    width: z.number().int().min(32).max(640),
    height: z.number().int().min(32).max(640),
    mime: z.enum(["video/mp4", "video/webm"]),
  })
  .strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to make stickers." }, { status: 401 });
  const { success } = await trackLimiter.limit(`video-sticker:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many stickers at once. Try again in a minute." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That sticker isn't valid." }, { status: 400 });
  const v = parsed.data;
  const bases = storageBasesFromEnv();
  if (!isOwnUpload(v.videoUrl, user.id, "video", bases) || !isOwnUpload(v.posterUrl, user.id, "image", bases)) {
    return NextResponse.json({ error: "That sticker isn't yours." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("video_stickers")
    .insert({ creator_id: user.id, video_url: v.videoUrl, poster_url: v.posterUrl, duration_ms: v.durationMs, width: v.width, height: v.height, mime: v.mime })
    .select("id")
    .single();
  if (error || !data) {
    const missing = /video_stickers|schema cache|does not exist/i.test(error?.message ?? "");
    return NextResponse.json({ error: missing ? "Video stickers arrive with the next update." : "Couldn't save the sticker." }, { status: missing ? 503 : 500 });
  }
  const id = videoStickerId(data.id as string);
  await db.from("user_stickers").upsert({ user_id: user.id, sticker: id }, { onConflict: "user_id,sticker", ignoreDuplicates: true });
  return NextResponse.json({ ok: true, sticker: { id, videoUrl: v.videoUrl, posterUrl: v.posterUrl } });
}
