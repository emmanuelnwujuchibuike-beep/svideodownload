import { normalizeShowcaseImage, normalizeShowcaseVideo, type ShowcaseImage, type ShowcaseVideo } from "./slides";

/**
 * The Frenz AI hub's TOOL CARDS — a picture (and optionally a short clip) per
 * card, set in Admin → Frenz AI → "Tool cards" (owner, 2026-10-07: "this page
 * showcase cards isn't set up in admin").
 *
 * Until now a card borrowed the picture of whichever carousel slide happened to
 * open its tool, so Audio Library, Your Voices and Your AI Videos — which no
 * slide opens — could never have one, and the others only had one by
 * coincidence. A card's own upload wins; the slide picture stays the fallback.
 *
 * Stored beside the slides in the same `ai_showcase` settings row, read into
 * the page at render (cached until an admin saves) — a visitor never asks.
 */

/** Every card on the hub, in the order the editor lists them. Ids match `AiToolId` (features/ai/frenz-ai-tools-grid.tsx). */
export const CARD_TOOLS = {
  text_to_video: "Text to Video",
  image_to_video: "Image to Video",
  lip_sync_pro: "Lip Sync Pro",
  text_to_audio: "Text to Audio",
  voice_clone: "Voice Cloning",
  audio_library: "Audio Library",
  voice_library: "Your Voices",
  history: "Your AI Videos",
} as const;

export type CardToolId = keyof typeof CARD_TOOLS;

export interface ShowcaseCardMedia {
  image: ShowcaseImage | null;
  /** Plays muted and looped only while the card is on screen; the image is its poster. */
  video: ShowcaseVideo | null;
}

export type ShowcaseCards = Partial<Record<CardToolId, ShowcaseCardMedia>>;

export function isCardToolId(value: unknown): value is CardToolId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CARD_TOOLS, value);
}

/** Whatever is stored (or posted) → cards safe to render: unknown tools and foreign URLs dropped, empty cards omitted. */
export function normalizeShowcaseCards(value: unknown, supabaseUrl: string | undefined): ShowcaseCards {
  const out: ShowcaseCards = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isCardToolId(id) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const image = normalizeShowcaseImage(r.image, supabaseUrl);
    // a clip needs its poster: without the image a card would be a black box while it loads
    const video = image ? normalizeShowcaseVideo(r.video, supabaseUrl) : null;
    if (image) out[id] = { image, video };
  }
  return out;
}

/** Every storage URL the cards point at — for cleaning up replaced uploads. */
export function cardFiles(cards: ShowcaseCards): string[] {
  return Object.values(cards).flatMap((c) => (c ? [...(c.image ? [c.image.sm, c.image.lg] : []), ...(c.video ? [c.video.url] : [])] : []));
}
