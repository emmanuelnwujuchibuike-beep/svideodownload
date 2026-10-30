import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { type LibraryChip, type LibrarySound, type LibraryTab } from "./sound-library-shared";
import { listSounds, type Sound } from "./sounds";

/**
 * The Sounds library's data (design/frenz-sounds.html — owner, 2026-10-30). Real rows only: the "Sound of the week" is
 * the top trending sound, the counts are the trigger-maintained uses, and a tab with nothing in it is shown empty —
 * never filled with sample sounds.
 *
 *   trending   public sounds by trend_score (recompute_sound_trend_scores), then uses
 *   new        public sounds, newest first
 *   following  "For you": sounds by creators the member follows, trending first
 *   saved      the member's saved sounds (0308 sound_saves), most recently saved first
 */
export async function listLibrary(opts: { tab: LibraryTab; chip: LibraryChip | null; q: string | null; viewerId: string | null; limit?: number }): Promise<LibrarySound[]> {
  const limit = opts.limit ?? 30;
  const base = { mood: opts.chip?.mood ?? null, genre: opts.chip?.genre ?? null, q: opts.q, limit };
  let sounds: Sound[] = [];
  if (opts.tab === "trending") sounds = await listSounds({ ...base, order: "trend" });
  else if (opts.tab === "new") sounds = await listSounds({ ...base, order: "new" });
  else if (!opts.viewerId) sounds = [];
  else if (opts.tab === "following") sounds = await listSounds({ ...base, order: "trend", createdBy: await followedIds(opts.viewerId) });
  else {
    const saved = await savedSoundIds(opts.viewerId, 200);
    const found = await listSounds({ ...base, order: "new", ids: saved, limit: 200 });
    const rank = new Map(saved.map((id, i) => [id, i]));
    sounds = found.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, limit);
  }
  return withVerified(sounds);
}

async function followedIds(viewerId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("follows").select("following_id").eq("follower_id", viewerId).limit(1000);
  if (error) return [];
  return ((data ?? []) as { following_id: string }[]).map((r) => r.following_id);
}

/** Each sound as the library shows it, with its creator's verified tick (one read for the whole page). */
async function withVerified(sounds: Sound[]): Promise<LibrarySound[]> {
  const creators = [...new Set(sounds.map((s) => s.createdBy))];
  const verified = new Set<string>();
  if (creators.length) {
    const { data } = await createAdminClient().from("profiles").select("id, is_verified").in("id", creators);
    for (const p of (data ?? []) as { id: string; is_verified: boolean | null }[]) if (p.is_verified) verified.add(p.id);
  }
  return sounds.map((s) => ({
    id: s.id,
    title: s.title,
    artistLabel: s.artistLabel,
    coverArtUrl: s.coverArtUrl,
    audioUrl: s.audioUrl,
    waveformPeaks: s.waveformPeaks,
    durationSec: s.durationSec,
    uses: s.usageCount,
    sourceType: s.sourceType,
    sourcePlatform: s.sourcePlatform,
    verified: verified.has(s.createdBy),
  }));
}

/** The sound page's verified tick for its creator. A failed read is "not verified" — never a tick it can't prove. */
export async function isCreatorVerified(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("profiles").select("is_verified").eq("id", userId).maybeSingle();
  return !error && data?.is_verified === true;
}

/** The member's saved sound ids, most recently saved first. A database before 0308 answers none. */
export async function savedSoundIds(viewerId: string, limit = 500): Promise<string[]> {
  const { data, error } = await createAdminClient().from("sound_saves").select("sound_id").eq("user_id", viewerId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return ((data ?? []) as { sound_id: string }[]).map((r) => r.sound_id);
}

/** Saves or unsaves a public sound. False when it can't (unknown or private sound, a database before 0308). */
export async function setSoundSaved(viewerId: string, soundId: string, saved: boolean): Promise<boolean> {
  const db = createAdminClient();
  if (!saved) {
    const { error } = await db.from("sound_saves").delete().eq("user_id", viewerId).eq("sound_id", soundId);
    return !error;
  }
  const { data: sound } = await db.from("sounds").select("id").eq("id", soundId).eq("is_public", true).maybeSingle();
  if (!sound) return false;
  const { error } = await db.from("sound_saves").upsert({ user_id: viewerId, sound_id: soundId }, { onConflict: "user_id,sound_id", ignoreDuplicates: true });
  return !error;
}
