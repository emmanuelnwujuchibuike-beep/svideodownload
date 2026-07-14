export const FONT_SIZES = ["small", "medium", "large", "xlarge"] as const;
export type ChatFontSize = (typeof FONT_SIZES)[number];

export const BUBBLE_STYLES = ["default", "compact", "sharp"] as const;
export type ChatBubbleStyle = (typeof BUBBLE_STYLES)[number];

export interface ChatAppearance {
  fontSize: ChatFontSize;
  bubbleStyle: ChatBubbleStyle;
  /** Hex string for the viewer's own sent bubbles, or null = today's default. */
  bubbleColor: string | null;
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontSize: "medium",
  bubbleStyle: "default",
  bubbleColor: null,
};

export function isChatFontSize(v: unknown): v is ChatFontSize {
  return typeof v === "string" && (FONT_SIZES as readonly string[]).includes(v);
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
    fontSize: isChatFontSize(row.font_size) ? row.font_size : DEFAULT_CHAT_APPEARANCE.fontSize,
    bubbleStyle: isChatBubbleStyle(row.bubble_style) ? row.bubble_style : DEFAULT_CHAT_APPEARANCE.bubbleStyle,
    bubbleColor: isHexColor(row.bubble_color) ? row.bubble_color : null,
  };
}

/** Tailwind text-size class per font-size preference — applied to the whole
 *  message-list container in ConversationRoom (both sent + received, a
 *  shape/legibility preference isn't sender-specific). */
export const FONT_SIZE_TEXT_CLASS: Record<ChatFontSize, string> = {
  small: "text-[13px]",
  medium: "text-sm",
  large: "text-[15px]",
  xlarge: "text-base",
};

export const FONT_SIZE_LABEL: Record<ChatFontSize, string> = {
  small: "Small",
  medium: "Default",
  large: "Large",
  xlarge: "Extra large",
};

/** Corner-radius/shape treatment per bubble-style preference. `base` sets all
 *  4 corners; `tailMine`/`tailTheirs`, when set, pinch the OUTGOING corner
 *  (bottom-right for mine, bottom-left for theirs) tighter — the classic
 *  "message tail" look. `sharp` deliberately has no tail (a flatter, more
 *  uniform silhouette is the actual visual distinction of that style, not a
 *  smaller pinch). Every value here is a full, literal Tailwind class string
 *  (never built at runtime via string concatenation) so the JIT scanner can
 *  see them statically — `rounded-br-${x}` built with `.replace()` would
 *  silently emit no CSS for any corner/size pair not already used verbatim
 *  elsewhere in the codebase. */
export const BUBBLE_STYLE_SHAPE: Record<ChatBubbleStyle, { base: string; tailMine: string | null; tailTheirs: string | null }> = {
  default: { base: "rounded-3xl", tailMine: "rounded-br-xl", tailTheirs: "rounded-bl-xl" },
  compact: { base: "rounded-xl", tailMine: "rounded-br-md", tailTheirs: "rounded-bl-md" },
  sharp: { base: "rounded-md", tailMine: null, tailTheirs: null },
};

export const BUBBLE_STYLE_LABEL: Record<ChatBubbleStyle, string> = {
  default: "Rounded",
  compact: "Compact",
  sharp: "Sharp",
};
