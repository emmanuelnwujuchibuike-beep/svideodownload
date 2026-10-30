import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A reel's own audio as a reusable sound (0308 — owner, 2026-10-30: "Sound page should be sound from videos, and users
 * can reuse sounds from videos … uploaded sounds too works").
 *
 * Every video reel a member posts gets an 'original' sound — "Original sound · @handle" — at publish
 * (app/api/stories/route.ts); a reel from before 0308 gets one the first time someone opens its sound
 * (app/api/sounds/from-post/[postId]). Its audio_url is the reel's own video file: an <audio> element plays an MP4's
 * audio track, and the worker's ffmpeg reads it when another reel reuses the sound (lib/social/sound-mix-plan.ts), so
 * nothing is extracted or stored twice. One sound per reel (sounds.origin_post_id is unique); the reel carries it as its
 * own sound_id, so it counts as the sound's first use and leads "Reels using this sound".
 *
 * 🔴 Only a member's OWN upload ('frenz') — a post saved from TikTok or YouTube is someone else's audio, and crediting it
 * to the member who saved it would be a false attribution. Those keep linking to the creator's profile.
 */

/** The post fields that decide whether its audio can become an original sound. */
export interface OriginalSoundSource {
  media_kind: string | null;
  platform: string | null;
  status: string | null;
  visibility: string | null;
  media_url: string | null;
  sound_id: string | null;
}

/** Pure: may this post's own audio become an original sound? (A post that already carries a sound has its sound.) */
export function canBecomeOriginalSound(p: OriginalSoundSource): boolean {
  return (
    p.media_kind === "video" &&
    p.platform === "frenz" &&
    p.status === "published" &&
    p.visibility === "public" &&
    typeof p.media_url === "string" &&
    p.media_url.startsWith("https://") &&
    !p.sound_id
  );
}

export const ORIGINAL_SOUND_TITLE = "Original sound";

/**
 * The sound a post plays: the one it carries, or — for an eligible reel without one — its original sound, made now.
 * Null when there is none to give (not a member's own public video, a database before 0308, any failure): the caller
 * falls back to the creator's profile, as before.
 */
export async function ensureOriginalSound(postId: string): Promise<string | null> {
  try {
    const db = createAdminClient();
    const { data: post } = await db
      .from("posts")
      .select("id, publisher_id, media_kind, platform, status, visibility, media_url, thumbnail_url, duration_sec, sound_id")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return null;
    if (post.sound_id) return post.sound_id as string;
    if (!canBecomeOriginalSound(post as OriginalSoundSource)) return null;

    // made already (an earlier tap that lost the race below, or a publish whose attach failed)? use it
    const existing = await db.from("sounds").select("id").eq("origin_post_id", postId).maybeSingle();
    if (existing.error) return null; // 0308 not applied: no original sounds yet
    let soundId = (existing.data?.id as string | undefined) ?? null;

    if (!soundId) {
      const { data: prof } = await db.from("profiles").select("handle").eq("id", post.publisher_id as string).maybeSingle();
      const handle = (prof?.handle as string | undefined) ?? null;
      if (!handle) return null;
      const made = await db
        .from("sounds")
        .insert({
          created_by: post.publisher_id,
          source_type: "original",
          title: ORIGINAL_SOUND_TITLE,
          artist_label: `@${handle}`,
          cover_art_url: (post.thumbnail_url as string | null) ?? null,
          audio_url: post.media_url,
          waveform_peaks: [],
          duration_sec: Math.max(0, Math.round(Number(post.duration_sec) || 0)),
          origin_post_id: postId,
        })
        .select("id")
        .maybeSingle();
      soundId = (made.data?.id as string | undefined) ?? null;
      // a unique-index clash: another request made it a moment ago — read theirs
      if (!soundId) soundId = ((await db.from("sounds").select("id").eq("origin_post_id", postId).maybeSingle()).data?.id as string | undefined) ?? null;
    }
    if (!soundId) return null;

    // the reel carries its own sound (only if it still carries none — never overwrite a sound it was given)
    await db.from("posts").update({ sound_id: soundId }).eq("id", postId).is("sound_id", null);
    return soundId;
  } catch {
    return null;
  }
}
