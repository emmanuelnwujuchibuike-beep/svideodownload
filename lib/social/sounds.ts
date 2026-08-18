import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sounds data layer (Feature 15 Part 7) — see docs/FEATURE_15_PART_7_MUSIC.md.
 *
 * A sound is decoupled from any one post: `created_by` owns it, `posts.sound_id`
 * is an optional attachment. `usage_count`/`plays_count` are trigger-maintained
 * in Postgres (migration 0125) — this layer never increments them directly,
 * only reads what the database already counted.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type SoundSourceType = "original" | "downloaded";

/**
 * Creator-set mood/genre vocabulary — a small fixed list the publisher picks
 * from, not an AI inference. Keeping this list here (not free text) is what
 * makes "browse by mood" possible without pretending the app understands the
 * audio; it's a tag, not a signal.
 */
export const SOUND_MOODS = [
  "happy",
  "relaxing",
  "energetic",
  "romantic",
  "motivational",
  "gaming",
  "workout",
  "travel",
  "night",
  "focus",
] as const;
export type SoundMood = (typeof SOUND_MOODS)[number];

export const SOUND_GENRES = [
  "pop",
  "hip-hop",
  "electronic",
  "lofi",
  "acoustic",
  "afrobeats",
  "rock",
  "ambient",
  "spoken-word",
  "comedy",
] as const;
export type SoundGenre = (typeof SOUND_GENRES)[number];

export interface Sound {
  id: string;
  createdBy: string;
  sourceType: SoundSourceType;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  title: string;
  artistLabel: string;
  coverArtUrl: string | null;
  audioUrl: string;
  waveformPeaks: number[];
  durationSec: number;
  moodTag: SoundMood | null;
  genreTag: SoundGenre | null;
  isPublic: boolean;
  usageCount: number;
  playsCount: number;
  createdAt: string;
}

interface SoundRow {
  id: string;
  created_by: string;
  source_type: SoundSourceType;
  source_platform: string | null;
  source_url: string | null;
  title: string;
  artist_label: string;
  cover_art_url: string | null;
  audio_url: string;
  waveform_peaks: number[] | null;
  duration_sec: number;
  mood_tag: string | null;
  genre_tag: string | null;
  is_public: boolean;
  usage_count: number;
  plays_count: number;
  created_at: string;
}

const SOUND_SELECT =
  "id, created_by, source_type, source_platform, source_url, title, artist_label, cover_art_url, audio_url, waveform_peaks, duration_sec, mood_tag, genre_tag, is_public, usage_count, plays_count, created_at";

function fromRow(r: SoundRow): Sound {
  return {
    id: r.id,
    createdBy: r.created_by,
    sourceType: r.source_type,
    sourcePlatform: r.source_platform,
    sourceUrl: r.source_url,
    title: r.title,
    artistLabel: r.artist_label,
    coverArtUrl: r.cover_art_url,
    audioUrl: r.audio_url,
    waveformPeaks: r.waveform_peaks ?? [],
    durationSec: r.duration_sec,
    moodTag: (r.mood_tag as SoundMood | null) ?? null,
    genreTag: (r.genre_tag as SoundGenre | null) ?? null,
    isPublic: r.is_public,
    usageCount: r.usage_count,
    playsCount: r.plays_count,
    createdAt: r.created_at,
  };
}

export interface CreateSoundInput {
  createdBy: string;
  sourceType: SoundSourceType;
  /** Required when sourceType is "downloaded" — enforced again by a DB check constraint. */
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  title: string;
  artistLabel: string;
  coverArtUrl?: string | null;
  audioUrl: string;
  waveformPeaks: number[];
  durationSec: number;
  moodTag?: SoundMood | null;
  genreTag?: SoundGenre | null;
}

export async function createSound(input: CreateSoundInput): Promise<Sound | null> {
  if (!hasSupabase) return null;
  if (input.sourceType === "downloaded" && (!input.sourcePlatform || !input.sourceUrl)) {
    // Mirrors the DB check constraint — fail here with a clear reason rather
    // than let a malformed insert bounce off Postgres with an opaque error.
    return null;
  }
  try {
    const { data, error } = await createAdminClient()
      .from("sounds")
      .insert({
        created_by: input.createdBy,
        source_type: input.sourceType,
        source_platform: input.sourcePlatform ?? null,
        source_url: input.sourceUrl ?? null,
        title: input.title,
        artist_label: input.artistLabel,
        cover_art_url: input.coverArtUrl ?? null,
        audio_url: input.audioUrl,
        waveform_peaks: input.waveformPeaks,
        duration_sec: Math.max(0, Math.round(input.durationSec)),
        mood_tag: input.moodTag ?? null,
        genre_tag: input.genreTag ?? null,
      })
      .select(SOUND_SELECT)
      .single();
    if (error || !data) return null;
    return fromRow(data as SoundRow);
  } catch {
    return null;
  }
}

export async function getSound(id: string, viewerId: string | null): Promise<Sound | null> {
  if (!hasSupabase) return null;
  try {
    const { data } = await createAdminClient().from("sounds").select(SOUND_SELECT).eq("id", id).maybeSingle();
    const row = data as SoundRow | null;
    if (!row) return null;
    if (!row.is_public && row.created_by !== viewerId) return null;
    return fromRow(row);
  } catch {
    return null;
  }
}

/** Attaches a sound to a post the caller owns — `posts.sound_id`'s trigger
 *  keeps `usage_count` in sync automatically. */
export async function attachSoundToPost(postId: string, publisherId: string, soundId: string | null): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const { error } = await createAdminClient()
      .from("posts")
      .update({ sound_id: soundId })
      .eq("id", postId)
      .eq("publisher_id", publisherId);
    return !error;
  } catch {
    return false;
  }
}

export interface TrendingSoundsFilter {
  mood?: SoundMood | null;
  genre?: SoundGenre | null;
  limit?: number;
}

/** Trending sounds, ranked by `trend_score` — the same materialized-column
 *  pattern as posts.hot_score (recomputed by `recompute_sound_trend_scores`,
 *  see the admin cron). Real counts driving the order, nothing modeled here. */
export async function listTrendingSounds(filter: TrendingSoundsFilter = {}): Promise<Sound[]> {
  if (!hasSupabase) return [];
  try {
    let q = createAdminClient().from("sounds").select(SOUND_SELECT).eq("is_public", true);
    if (filter.mood) q = q.eq("mood_tag", filter.mood);
    if (filter.genre) q = q.eq("genre_tag", filter.genre);
    const { data, error } = await q.order("trend_score", { ascending: false }).limit(filter.limit ?? 30);
    if (error || !data) return [];
    return (data as SoundRow[]).map(fromRow);
  } catch {
    return [];
  }
}

export async function listNewSounds(limit = 30): Promise<Sound[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("sounds")
      .select(SOUND_SELECT)
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as SoundRow[]).map(fromRow);
  } catch {
    return [];
  }
}

/** A creator's own sounds (public or not — this is their own list). */
export async function listMySounds(createdBy: string, limit = 60): Promise<Sound[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("sounds")
      .select(SOUND_SELECT)
      .eq("created_by", createdBy)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as SoundRow[]).map(fromRow);
  } catch {
    return [];
  }
}

/**
 * Plain title/artist search — same `ilike` approach `lib/social/search.ts`
 * uses for posts, so results feel consistent across content types.
 *
 * `sanitize` mirrors that file's own `clean()` exactly (strip characters that
 * would break a PostgREST `or`/`ilike` filter) — duplicated rather than
 * imported to avoid a circular import, since `search.ts` imports FROM this
 * module to aggregate sound results into `searchAll`.
 */
function sanitize(q: string): string {
  return q.replace(/[,%()*]/g, " ").replace(/#/g, "").trim().slice(0, 60);
}

export async function searchSounds(query: string, limit = 30): Promise<Sound[]> {
  if (!hasSupabase) return [];
  const q = sanitize(query);
  if (!q) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("sounds")
      .select(SOUND_SELECT)
      .eq("is_public", true)
      .or(`title.ilike.%${q}%,artist_label.ilike.%${q}%`)
      .order("trend_score", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as SoundRow[]).map(fromRow);
  } catch {
    return [];
  }
}

/** Posts/reels carrying this sound, newest first — powers the Sound Page's
 *  "Reels using this sound" grid. Shaped exactly like `PostCard`
 *  (lib/social/posts.ts) so it can render through the SAME `PostGrid` every
 *  other related/grid surface uses — same instant-open viewers, no new grid
 *  component. Public, published posts only (a sound page is public). */
export async function listPostsForSound(soundId: string, limit = 24): Promise<import("./posts").PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("posts")
      .select("id, title, platform, media_kind, thumbnail_url, media_url, category, views_count, likes_count, comments_count, created_at")
      .eq("sound_id", soundId)
      .eq("status", "published")
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (
      data as {
        id: string;
        title: string;
        platform: string;
        media_kind: "video" | "image" | "audio";
        thumbnail_url: string | null;
        media_url: string | null;
        category: string | null;
        views_count: number;
        likes_count: number;
        comments_count: number;
        created_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      platform: r.platform,
      mediaKind: r.media_kind,
      thumbnailUrl: r.thumbnail_url,
      mediaUrl: r.media_url,
      category: r.category,
      viewsCount: r.views_count,
      likesCount: r.likes_count,
      commentsCount: r.comments_count,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** Records one deduped play (per viewer|ip, per day) — mirrors `recordPostView`.
 *  Fire-and-forget from the caller's perspective; failures are swallowed since
 *  a missed play count is never worth failing playback over. */
export async function recordSoundPlay(soundId: string, viewerId: string | null, ipHash: string): Promise<void> {
  if (!hasSupabase) return;
  try {
    await createAdminClient()
      .from("sound_plays")
      .insert({ sound_id: soundId, viewer_id: viewerId, ip_hash: ipHash });
  } catch {
    /* dedup unique-violation on a repeat same-day play is expected, not an error */
  }
}

/** Recompute trend_score for recent sounds — same shape as recomputeHotScores
 *  (lib/social/feed.ts), wired into the same trending cron. Fixed weights for
 *  now (no admin-tunable settings row for sounds yet — usage counts double
 *  as much as a play, mirroring posts' own bias toward the stronger
 *  engagement signal). */
export async function recomputeSoundTrendScores(): Promise<number> {
  if (!hasSupabase) return 0;
  const { data } = await createAdminClient().rpc("recompute_sound_trend_scores", {
    w_usage: 2,
    w_play: 1,
    gravity: 1.5,
    max_age_hours: 24 * 30,
  });
  return (data as number) ?? 0;
}
