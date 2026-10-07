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
