import type { Heart } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The Wow reaction flavors and the glyph helpers, on their own (2026-10-31, "split the feed page"): every feed card
 * draws the viewer's own reaction glyph, but only a long-press ever opens the picker — and the picker brings
 * framer-motion with it. With these here, the card imports this small module up front and loads the picker
 * (features/social/reaction-picker.tsx, which re-exports these) only when it is needed.
 * Emoji here are USER REACTIONS — content, not UI chrome — the approved exception to the no-emoji rule.
 */
export const REACTIONS = [
  { id: "love", glyph: "❤️", label: "Love" },
  { id: "fire", glyph: "🔥", label: "Fire" },
  { id: "funny", glyph: "😂", label: "Funny" },
  { id: "applause", glyph: "👏", label: "Applause" },
  { id: "surprised", glyph: "😮", label: "Surprised" },
  { id: "celebrate", glyph: "🎉", label: "Celebrate" },
  { id: "insightful", glyph: "💡", label: "Insightful" },
  { id: "support", glyph: "🤝", label: "Support" },
] as const;

export type ReactionEmotion = (typeof REACTIONS)[number]["id"];

export function reactionGlyph(emotion: string | null | undefined): string | null {
  return REACTIONS.find((r) => r.id === emotion)?.glyph ?? null;
}

/**
 * Wraps a picked glyph so it can sit in any `typeof Heart` icon slot
 * (ActionButton/RailButton require a forwardRef component — a plain FC
 * isn't assignable to lucide's icon type).
 */
export function makeEmotionIcon(glyph: string): typeof Heart {
  const EmotionGlyph = forwardRef<SVGSVGElement, { className?: string }>(function EmotionGlyph(
    { className },
    _ref,
  ) {
    return (
      <span aria-hidden className={cn("flex items-center justify-center leading-none", className)} style={{ fontSize: "1.05em" }}>
        {glyph}
      </span>
    );
  });
  return EmotionGlyph as unknown as typeof Heart;
}
