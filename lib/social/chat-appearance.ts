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
export const BUBBLE_STYLES = ["classic", "modern", "sharp", "pill", "tail"] as const;
export type ChatBubbleStyle = (typeof BUBBLE_STYLES)[number];

export interface ChatAppearance {
  fontStyle: ChatFontStyle;
  bubbleStyle: ChatBubbleStyle;
  /** Hex string for the viewer's own sent bubbles, or null = today's default. */
  bubbleColor: string | null;
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontStyle: "default",
  bubbleStyle: "classic",
  bubbleColor: null,
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
  classic: { base: "rounded-3xl", tailMine: "rounded-br-xl", tailTheirs: "rounded-bl-xl" },
  modern: { base: "rounded-3xl", tailMine: null, tailTheirs: null },
  sharp: { base: "rounded-md", tailMine: null, tailTheirs: null },
  pill: { base: "rounded-full", tailMine: null, tailTheirs: null },
  tail: { base: "rounded-2xl", tailMine: null, tailTheirs: null, protrudingTail: true },
};

export const BUBBLE_STYLE_LABEL: Record<ChatBubbleStyle, string> = {
  classic: "Classic",
  modern: "Modern",
  sharp: "Sharp",
  pill: "Pill",
  tail: "Speech tail",
};
