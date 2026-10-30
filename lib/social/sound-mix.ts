import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The database side of a reel made with "Use this sound" (0308, posts.sound_mix_state). The publish marks the reel
 * 'pending'; the worker (server/services/sound-mix-service.ts) swaps its audio for the sound and marks it 'done', or
 * 'failed' after repeated failures — a failed reel keeps playing as it was uploaded, still labelled with its sound.
 * Every write is conditional on 'pending', so a reel is never mixed twice. A database before 0308 answers nothing and
 * changes nothing.
 */

/** Marks a just-published reel for the worker. False when there is nothing to do (its own sound, an unknown sound). */
export async function markSoundMix(postId: string, soundId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const { data: sound } = await db.from("sounds").select("id, audio_url, is_public, origin_post_id").eq("id", soundId).maybeSingle();
    if (!sound || !(sound.is_public as boolean) || !(sound.audio_url as string | null)) return false;
    // a reel's own original sound is already its audio
    if (sound.origin_post_id === postId) return false;
    const { data, error } = await db.from("posts").update({ sound_mix_state: "pending" }).eq("id", postId).eq("sound_id", soundId).is("sound_mix_state", null).select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export interface PendingSoundMix {
  postId: string;
  publisherId: string;
  videoUrl: string;
  soundUrl: string;
}

/** Reels waiting for their sound, oldest first. */
export async function pendingSoundMixes(limit: number): Promise<PendingSoundMix[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("posts")
      .select("id, publisher_id, media_url, sound_id")
      .eq("sound_mix_state", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error || !data?.length) return [];
    const rows = data as { id: string; publisher_id: string; media_url: string | null; sound_id: string | null }[];
    const ids = [...new Set(rows.map((r) => r.sound_id).filter((s): s is string => !!s))];
    const { data: sounds } = ids.length ? await db.from("sounds").select("id, audio_url").in("id", ids) : { data: [] };
    const audio = new Map(((sounds ?? []) as { id: string; audio_url: string | null }[]).map((s) => [s.id, s.audio_url]));
    const out: PendingSoundMix[] = [];
    for (const r of rows) {
      const soundUrl = r.sound_id ? audio.get(r.sound_id) : null;
      if (r.media_url && soundUrl) out.push({ postId: r.id, publisherId: r.publisher_id, videoUrl: r.media_url, soundUrl });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The reel now plays the mixed file. Its Cloudflare Stream copy (if one was made before the swap) still carries the old
 * audio, so it is let go: the reel plays its MP4. Only a reel still 'pending' is changed.
 */
export async function finishSoundMix(postId: string, mixedUrl: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("posts")
      .update({ media_url: mixedUrl, stream_uid: null, sound_mix_state: "done" })
      .eq("id", postId)
      .eq("sound_mix_state", "pending")
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Gives up on a reel: it keeps its own audio. */
export async function failSoundMix(postId: string): Promise<void> {
  await createAdminClient()
    .from("posts")
    .update({ sound_mix_state: "failed" })
    .eq("id", postId)
    .eq("sound_mix_state", "pending")
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Is this reel still waiting for its sound? (Stream ingest waits: it would copy the old audio.) */
export async function soundMixPending(postId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("posts").select("sound_mix_state").eq("id", postId).maybeSingle();
    return data?.sound_mix_state === "pending";
  } catch {
    return false;
  }
}
