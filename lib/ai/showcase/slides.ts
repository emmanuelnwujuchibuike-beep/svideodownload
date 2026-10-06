/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI SHOWCASE — the admin-editable slides on the welcome page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-05: "The showcase card titles, description and images should
 * be able to be uploaded or change by the admin, images, titles and
 * descriptions must fit professional as it is in the reference image."
 *
 * Pure: types, the limits, the link targets, the normaliser and the defaults.
 * No I/O, so the admin editor, the API route, the server reader and the tests
 * all apply the SAME rules (lib/ai/showcase/server.ts reads, the route writes).
 *
 * ── Why the limits are the design ───────────────────────────────────────────
 *
 * "Must fit professional" is a length question. The card is drawn for at most
 * two lines of headline and two of description on a 320 px phone, where the
 * card is 264 px wide and its text column ~232 px. Every limit below is what
 * fits THERE (measured on a production build, 2026-10-05 — the first limits,
 * 24/16/90, overflowed the description into an ellipsis at 320), so no admin
 * wording can wrap into a third line on any phone.
 * The editor enforces them as you type and the server enforces them again,
 * because a limit only checked in the browser is a suggestion.
 *
 * ── Why a link is a TARGET, not a URL ───────────────────────────────────────
 *
 * The welcome page has two doors (/ai and /studio/ai) and a slide must open the
 * same tool from either. Storing a tool key and resolving it against the door's
 * base does that, and it means an admin cannot point a slide at a page that
 * does not exist or at another site — every target below is a real route in
 * BOTH groups (the truth rule; `slides.test.ts` checks the files exist).
 */

export const SHOWCASE_LIMITS = {
  slides: 8,
  chip: 20,
  title: 18,
  highlight: 18,
  description: 64,
  alt: 120,
} as const;

/** Tool pages a slide may open, as the path under the door's base. */
export const SHOWCASE_TARGETS = {
  explore: { label: "Explore AI Studio", path: "/character-replace" },
  "text-to-video": { label: "Text to Video", path: "/text-to-video" },
  "image-to-video": { label: "Image to Video", path: "/image-to-video" },
  "lip-sync": { label: "Lip Sync", path: "/lip-sync" },
  "text-to-audio": { label: "Text to Audio", path: "/text-to-audio" },
  "voice-cloning": { label: "Voice Cloning", path: "/voice-cloning" },
  history: { label: "Your creations", path: "/history" },
} as const;

export type ShowcaseTarget = keyof typeof SHOWCASE_TARGETS;

/** The two pre-sized copies made at upload (lib/media/thumbnail.ts). */
export interface ShowcaseImage {
  /** ~720 px wide webp — a phone at 1x/2x, and every lazy slide's first pick. */
  sm: string;
  /** ~1280 px wide webp — a 3x phone, a tablet, a desktop card. */
  lg: string;
  width: number;
  height: number;
}

export interface ShowcaseSlide {
  id: string;
  enabled: boolean;
  chip: string;
  title: string;
  /** The headline's SECOND line (the reference: "Turn Words" / "Into Motion"). */
  highlight: string;
  description: string;
  target: ShowcaseTarget;
  image: ShowcaseImage | null;
  /**
   * An optional short clip (owner, 2026-10-06: "backend to upload images and
   * video where required in the showcase cards"). Plays muted and looped ONLY
   * while its slide is the active one and on screen; the image is its poster
   * and what everyone else sees. See ai-showcase.tsx.
   */
  video: ShowcaseVideo | null;
  /** Describes the IMAGE for a screen reader; empty when it is decorative. */
  alt: string;
}

/** An uploaded clip: MP4 or WebM in the showcase bucket, stored as uploaded. */
export interface ShowcaseVideo {
  url: string;
  bytes: number;
}

/** The video limits the admin route enforces. 12 MB keeps a phone's first play fast. */
export const SHOWCASE_VIDEO = {
  maxBytes: 12 * 1024 * 1024,
  mimeTypes: ["video/mp4", "video/webm"] as const,
  /** How long a slide with a clip stays up, at most (its own length, 3–8 s). */
  maxDwellMs: 8000,
} as const;

/*
  The four live tools, so the carousel is real before an admin has uploaded
  anything. No image: the card draws its own brand art (no bytes), and an
  upload replaces it. Every claim here is a page that exists.
*/
export const DEFAULT_SHOWCASE: ShowcaseSlide[] = [
  {
    id: "default-t2v",
    enabled: true,
    chip: "Text to Video",
    title: "Turn Words",
    highlight: "Into Motion",
    description: "Describe a scene and watch it filmed, in any style you like.",
    target: "text-to-video",
    image: null,
    video: null,
    alt: "",
  },
  {
    id: "default-i2v",
    enabled: true,
    chip: "Image to Video",
    title: "Bring Photos",
    highlight: "To Life",
    description: "Give a still photo motion. Say how it moves.",
    target: "image-to-video",
    image: null,
    video: null,
    alt: "",
  },
  {
    id: "default-lipsync",
    enabled: true,
    chip: "Lip Sync",
    title: "Any Voice,",
    highlight: "Any Language",
    description: "Match a video's mouth to a new voice, naturally.",
    target: "lip-sync",
    image: null,
    video: null,
    alt: "",
  },
  {
    id: "default-audio",
    enabled: true,
    chip: "Voice & Audio",
    title: "Type It.",
    highlight: "Hear It.",
    description: "Turn text into natural speech, or clone your own voice.",
    target: "text-to-audio",
    image: null,
    video: null,
    alt: "",
  },
];

/** Collapse whitespace, strip control characters, cut to the limit. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isShowcaseTarget(value: unknown): value is ShowcaseTarget {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHOWCASE_TARGETS, value);
}

/**
 * An image URL is accepted only from OUR public showcase bucket. Anything else
 * — another host, http:, a protocol-relative `//`, a data: URI — is dropped,
 * so a stored value can never make a visitor's browser fetch from elsewhere.
 */
export function isShowcaseImageUrl(value: unknown, supabaseUrl: string | undefined): value is string {
  if (typeof value !== "string" || !supabaseUrl || value.length > 2048) return false;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${SHOWCASE_BUCKET}/`;
  return value.startsWith(prefix) && !value.slice(prefix.length).includes("..");
}

export const SHOWCASE_BUCKET = "ai-showcase";

function normalizeVideo(value: unknown, supabaseUrl: string | undefined): ShowcaseVideo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isShowcaseImageUrl(v.url, supabaseUrl) || !/.(mp4|webm)$/i.test(v.url)) return null;
  const bytes = typeof v.bytes === "number" && v.bytes > 0 ? Math.round(v.bytes) : 0;
  return { url: v.url, bytes };
}

function normalizeImage(value: unknown, supabaseUrl: string | undefined): ShowcaseImage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isShowcaseImageUrl(v.sm, supabaseUrl) || !isShowcaseImageUrl(v.lg, supabaseUrl)) return null;
  const width = typeof v.width === "number" && v.width > 0 ? Math.round(v.width) : 1280;
  const height = typeof v.height === "number" && v.height > 0 ? Math.round(v.height) : 720;
  return { sm: v.sm, lg: v.lg, width, height };
}

/**
 * Whatever is stored (or posted) → slides that are safe to render. Bad entries
 * are dropped rather than repaired into something the admin did not write; a
 * slide with no headline at all is not a slide.
 */
export function normalizeShowcase(value: unknown, supabaseUrl: string | undefined): ShowcaseSlide[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ShowcaseSlide[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = cleanText(r.id, 64);
    if (!id || seen.has(id)) continue;
    const title = cleanText(r.title, SHOWCASE_LIMITS.title);
    const highlight = cleanText(r.highlight, SHOWCASE_LIMITS.highlight);
    if (!title && !highlight) continue;
    seen.add(id);
    out.push({
      id,
      enabled: r.enabled !== false,
      chip: cleanText(r.chip, SHOWCASE_LIMITS.chip),
      title,
      highlight,
      description: cleanText(r.description, SHOWCASE_LIMITS.description),
      target: isShowcaseTarget(r.target) ? r.target : "explore",
      image: normalizeImage(r.image, supabaseUrl),
      video: normalizeVideo(r.video, supabaseUrl),
      alt: cleanText(r.alt, SHOWCASE_LIMITS.alt),
    });
    if (out.length >= SHOWCASE_LIMITS.slides) break;
  }
  return out;
}

/** What visitors see: the enabled slides, or the defaults when none are. */
export function visibleSlides(stored: ShowcaseSlide[] | null): ShowcaseSlide[] {
  // `null` = never saved → the defaults. A saved list with every slide switched
  // off is the admin hiding the carousel, and that is honoured.
  if (stored === null) return DEFAULT_SHOWCASE;
  return stored.filter((s) => s.enabled);
}

export function slideHref(base: string, target: ShowcaseTarget): string {
  return `${base}${SHOWCASE_TARGETS[target].path}`;
}

/**
 * Every page that renders the showcase. The admin save drops each one's cached
 * HTML (app/api/admin/ai/showcase/route.ts) — a page that shows the slides but
 * is missing here would keep the old ones until its next build.
 * `slides.test.ts` checks this list against the pages that call the reader.
 */
export const SHOWCASE_PAGES = [
  "/ai",
  "/studio/ai",
  "/ai/character-replace",
  "/studio/ai/character-replace",
  "/ai/text-to-video",
  "/studio/ai/text-to-video",
  "/ai/image-to-video",
  "/studio/ai/image-to-video",
  "/ai/text-to-audio",
  "/studio/ai/text-to-audio",
  "/ai/voice-cloning",
  "/studio/ai/voice-cloning",
  "/ai/lip-sync",
  "/studio/ai/lip-sync",
] as const;
