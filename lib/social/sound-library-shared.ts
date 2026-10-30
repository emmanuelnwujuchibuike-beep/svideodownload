import type { SoundGenre, SoundMood } from "./sounds-shared";

/**
 * The Sounds library's vocabulary (design/frenz-sounds.html) — browser-safe, shared by the page and its API.
 *
 * The design's filter chips mix moods and genres ("Afrobeats", "Romantic", "Workout"…). Each chip is one of the
 * creator-set tags that already exist (lib/social/sounds-shared.ts) — never a new free-text label — so a chip can only
 * ever show sounds a creator actually tagged that way. A reel's original sound carries no tag until its creator adds one.
 */
export const LIBRARY_TABS = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "following", label: "For you" },
  { id: "saved", label: "Saved" },
] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number]["id"];

export function isLibraryTab(v: unknown): v is LibraryTab {
  return typeof v === "string" && LIBRARY_TABS.some((t) => t.id === v);
}

/** A tab that answers differently per member (never cached publicly). */
export function isPersonalTab(tab: LibraryTab): boolean {
  return tab === "following" || tab === "saved";
}

export type LibraryChip = { id: string; label: string; mood?: SoundMood; genre?: SoundGenre };

const g = (id: SoundGenre, label: string): LibraryChip => ({ id, label, genre: id });
const m = (id: SoundMood, label: string): LibraryChip => ({ id, label, mood: id });

/** The design's chips, in its order ("All" is no chip). */
export const LIBRARY_CHIPS: readonly LibraryChip[] = [
  g("afrobeats", "Afrobeats"),
  g("hip-hop", "Hip-Hop"),
  g("comedy", "Comedy"),
  m("romantic", "Romantic"),
  m("energetic", "Energetic"),
  g("lofi", "Lofi"),
  g("spoken-word", "Spoken-Word"),
  m("motivational", "Motivational"),
  g("ambient", "Ambient"),
  g("pop", "Pop"),
  m("workout", "Workout"),
];

export function chipById(id: unknown): LibraryChip | null {
  return LIBRARY_CHIPS.find((c) => c.id === id) ?? null;
}

/** The design's "Browse by genre" tiles — each opens its chip. The design's colour pairs, as theme classes (dark mode too). */
export const LIBRARY_GENRE_TILES: readonly { chip: string; label: string; line: string; tone: string }[] = [
  { chip: "afrobeats", label: "Afrobeats", line: "Lagos to the world", tone: "bg-zinc-950 text-white dark:bg-white/10" },
  { chip: "comedy", label: "Comedy", line: "Skits & punchlines", tone: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200" },
  { chip: "hip-hop", label: "Hip-Hop", line: "Bars and beats", tone: "bg-frenz-fill text-frenz-ink" },
  { chip: "romantic", label: "Romantic", line: "Slow & soft", tone: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200" },
  { chip: "motivational", label: "Motivational", line: "Speeches & hype", tone: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  { chip: "lofi", label: "Lofi", line: "Late-night calm", tone: "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
];

/** One sound as the library shows it. `uses` is the real count of reels carrying it (0125's trigger). */
export interface LibrarySound {
  id: string;
  title: string;
  artistLabel: string;
  coverArtUrl: string | null;
  audioUrl: string;
  waveformPeaks: number[];
  durationSec: number;
  uses: number;
  sourceType: "original" | "downloaded";
  sourcePlatform: string | null;
  verified: boolean;
}

export function reelsLabel(n: number): string {
  return `${n} ${n === 1 ? "reel" : "reels"}`;
}
