/** 10 distinct typeface choices (owner ask, 2026-07-15: this was previously a
 *  font-SIZE picker — "the chat option font settings is font style selection
 *  of 10 different font style not font size"). The underlying DB column/API
 *  field stays `font_size`/`fontSize` (avoids a migration; it's just a text
 *  column) but now stores one of these style ids, not a size. */
export const FONT_STYLES = [
  "default",
  "classic",
  "elegant",
  "modern",
  "rounded",
  "bold",
  "minimal",
  "mono",
  "handwritten",
  "playful",
] as const;
export type ChatFontStyle = (typeof FONT_STYLES)[number];

/** Real structural bubble shapes, not just corner-radius tweaks (owner ask,
 *  2026-07-15, referencing a saved reference image of speech-bubble shapes):
 *  `classic` has a pinched tail corner, `modern` is uniformly rounded with no
 *  tail, `sharp` is boxy, `pill` is a full capsule, `tail` adds a genuine
 *  protruding pointer via a pseudo-element (see BUBBLE_STYLE_SHAPE below). */
/**
 * The design's bubble skins (owner, 2026-10-23, design/frenzsave-bubble-styles.html) — drawn bubbles with
 * decorations, painted on the viewer's OWN sent text bubbles. "Default" in the picker is `classic` (the chat's
 * gradient). Listed literally for the API's enum; bubble-skins.test.ts holds this list to the generated data.
 */
export const BUBBLE_SKINS = [
  "doodle", "cat", "bee", "ghost", "pumpkin", "web", "bunny", "panda", "shark", "dino",
  "sprout", "sunflower", "cloud", "berry", "galaxy", "crown", "neon", "boba", "pixel", "letter",
] as const;
export type ChatBubbleSkin = (typeof BUBBLE_SKINS)[number];
export const BUBBLE_STYLES = ["classic", "modern", "sharp", "pill", "tail", ...BUBBLE_SKINS] as const;
export type ChatBubbleStyle = (typeof BUBBLE_STYLES)[number];

/** Pro-only skins (the design: "Galaxy, Crowned and Neon sign come with Frenzsave Pro") — the API refuses them to a free plan. */
export const PRO_BUBBLE_SKINS: readonly ChatBubbleSkin[] = ["galaxy", "crown", "neon"];
/** Halloween skins: "Spooky season only — gone after October". */
export const HALLOWEEN_BUBBLE_SKINS: readonly ChatBubbleSkin[] = ["ghost", "pumpkin", "web"];

export function isBubbleSkin(v: string): v is ChatBubbleSkin {
  return (BUBBLE_SKINS as readonly string[]).includes(v);
}

/** Is this style on offer at `now`? Halloween skins only in October (the viewer's own month). */
export function bubbleStyleAvailable(style: ChatBubbleStyle, now: Date = new Date()): boolean {
  return !(HALLOWEEN_BUBBLE_SKINS as readonly string[]).includes(style) || now.getMonth() === 9;
}

/** The style a bubble is actually painted with: a saved Halloween skin falls back to the default after October. */
export function effectiveBubbleStyle(style: ChatBubbleStyle, now: Date = new Date()): ChatBubbleStyle {
  return bubbleStyleAvailable(style, now) ? style : "classic";
}

export interface ChatAppearance {
  fontStyle: ChatFontStyle;
  bubbleStyle: ChatBubbleStyle;
  /** Hex string for the viewer's own sent bubbles, or null = today's default. */
  bubbleColor: string | null;
  /** The viewer's PERSONAL wallpaper for this chat ("Only you" scope, migration
   *  0080), or null = none — in which case the conversation's shared wallpaper
   *  (`conversations.wallpaper_url`, the "Both of you" scope) shows instead.
   *  A personal wallpaper always wins over the shared one. */
  wallpaperUrl: string | null;
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontStyle: "default",
  bubbleStyle: "classic",
  bubbleColor: null,
  wallpaperUrl: null,
};

/** Where a chat wallpaper applies (owner ask, 2026-07-16). */
export const WALLPAPER_SCOPES = ["both", "me"] as const;
export type WallpaperScope = (typeof WALLPAPER_SCOPES)[number];

export const WALLPAPER_SCOPE_LABEL: Record<WallpaperScope, string> = {
  both: "Both of you",
  me: "Only you",
};

export const WALLPAPER_SCOPE_HINT: Record<WallpaperScope, string> = {
  both: "You and them both see this background.",
  me: "Only you see it. They keep their own.",
};

export function isChatFontStyle(v: unknown): v is ChatFontStyle {
  return typeof v === "string" && (FONT_STYLES as readonly string[]).includes(v);
}

export function isChatBubbleStyle(v: unknown): v is ChatBubbleStyle {
  return typeof v === "string" && (BUBBLE_STYLES as readonly string[]).includes(v);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR.test(v);
}

export interface ChatAppearanceRow {
  font_size: string | null;
  bubble_style: string | null;
  bubble_color: string | null;
  /** Migration 0080 — may be absent on a row selected before it's applied. */
  wallpaper_url?: string | null;
}

/** Pure row→camelCase mapper, shared by the API route (session-scoped client
 *  reads/writes its own row directly, no admin client needed for this one —
 *  there's no SSR consumer, unlike home-preferences). */
export function fromChatAppearanceRow(row: ChatAppearanceRow | null): ChatAppearance {
  if (!row) return DEFAULT_CHAT_APPEARANCE;
  return {
    fontStyle: isChatFontStyle(row.font_size) ? row.font_size : DEFAULT_CHAT_APPEARANCE.fontStyle,
    bubbleStyle: isChatBubbleStyle(row.bubble_style) ? row.bubble_style : DEFAULT_CHAT_APPEARANCE.bubbleStyle,
    bubbleColor: isHexColor(row.bubble_color) ? row.bubble_color : null,
    wallpaperUrl: typeof row.wallpaper_url === "string" && row.wallpaper_url ? row.wallpaper_url : null,
  };
}

export const FONT_STYLE_LABEL: Record<ChatFontStyle, string> = {
  default: "Default",
  classic: "Classic",
  elegant: "Elegant",
  modern: "Modern",
  rounded: "Rounded",
  bold: "Bold",
  minimal: "Minimal",
  mono: "Mono",
  handwritten: "Handwritten",
  playful: "Playful",
};

/** Corner-radius/shape treatment per bubble-style preference. `base` sets all
 *  4 corners; `tailMine`/`tailTheirs`, when set, pinch the OUTGOING corner
 *  (bottom-right for mine, bottom-left for theirs) tighter — the classic
 *  "message tail" look via radius alone. `protrudingTail`, when true, instead
 *  adds a real triangular pointer sticking OUT of the bubble body (see the
 *  `.chat-bubble-tail-*` rules in globals.css) — a genuinely different
 *  STRUCTURE, not another radius variant; `base` for that style intentionally
 *  has no radius pinch of its own since the pseudo-element carries the tail.
 *  Every Tailwind value here is a full, literal class string (never built at
 *  runtime via string concatenation) so the JIT scanner can see them
 *  statically — `rounded-br-${x}` built with `.replace()` would silently
 *  emit no CSS for any corner/size pair not already used verbatim elsewhere. */
export const BUBBLE_STYLE_SHAPE: Record<
  ChatBubbleStyle,
  { base: string; tailMine: string | null; tailTheirs: string | null; protrudingTail?: boolean }
> = {
  // the design's bubble (design/Chat.dc.html, 2026-10-18): 20 px corners, a 6 px tail on the last bubble of a group
  classic: { base: "rounded-[20px]", tailMine: "rounded-br-md", tailTheirs: "rounded-bl-md" },
  modern: { base: "rounded-3xl", tailMine: null, tailTheirs: null },
  sharp: { base: "rounded-md", tailMine: null, tailTheirs: null },
  pill: { base: "rounded-full", tailMine: null, tailTheirs: null },
  tail: { base: "rounded-2xl", tailMine: null, tailTheirs: null, protrudingTail: true },
  // skins draw their own outline (bubble-skins.module.css); the theirs side keeps the classic shape
  ...(Object.fromEntries(BUBBLE_SKINS.map((k) => [k, { base: "rounded-[20px]", tailMine: null, tailTheirs: "rounded-bl-md" }])) as Record<
    ChatBubbleSkin,
    { base: string; tailMine: string | null; tailTheirs: string | null }
  >),
};

export const BUBBLE_STYLE_LABEL: Record<ChatBubbleStyle, string> = {
  classic: "Default",
  modern: "Modern",
  sharp: "Sharp",
  pill: "Pill",
  tail: "Speech tail",
  doodle: "Doodle", cat: "Sleepy cat", bee: "Honey bee", ghost: "Ghosty", pumpkin: "Jack-o", web: "Night web",
  bunny: "Bunny ears", panda: "Panda hug", shark: "Shark fin", dino: "Dino", sprout: "Sprout", sunflower: "Sunflower",
  cloud: "Cloudy day", berry: "Strawberry", galaxy: "Galaxy", crown: "Crowned", neon: "Neon sign", boba: "Boba",
  pixel: "8-bit", letter: "Love letter",
};
