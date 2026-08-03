import { cn } from "@/lib/utils";

/**
 * The reputation rank emblem — a dimensional crown.
 *
 * Owner (2026-08-03): "change the rank icon that is beside the rank text on the
 * profile from AI icon to a crown or trophy premium 3d icon." It was lucide's
 * `Sparkles`, which reads as an AI glyph everywhere else in the product.
 *
 * Drawn rather than taken from the icon set because the depth is the point: a
 * flat stroked outline sitting on the rank's own metallic gradient looked
 * pasted on. This is three layers — a shadowed base, the gold body with its own
 * vertical gradient, and a top highlight — so it catches light like the chip it
 * sits on. Pure SVG, no asset request, and it inherits size from `className`.
 */
export function RankCrown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 shrink-0", className)}>
      <defs>
        <linearGradient id="rankCrownBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6d5" />
          <stop offset="45%" stopColor="#ffd76a" />
          <stop offset="100%" stopColor="#e0972a" />
        </linearGradient>
        <linearGradient id="rankCrownGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Cast shadow, a hair below the body — what sells the depth. */}
      <path
        d="M3 8.6l4.2 3.1L12 5.1l4.8 6.6L21 8.6l-1.7 9.1a1.4 1.4 0 0 1-1.4 1.1H6.1a1.4 1.4 0 0 1-1.4-1.1L3 8.6z"
        fill="#000000"
        opacity="0.22"
        transform="translate(0 0.9)"
      />
      {/* Body */}
      <path
        d="M3 8.6l4.2 3.1L12 5.1l4.8 6.6L21 8.6l-1.7 9.1a1.4 1.4 0 0 1-1.4 1.1H6.1a1.4 1.4 0 0 1-1.4-1.1L3 8.6z"
        fill="url(#rankCrownBody)"
      />
      {/* Top highlight across the peaks */}
      <path
        d="M3 8.6l4.2 3.1L12 5.1l4.8 6.6L21 8.6l-.6 3.2c-2.9-.5-5.7-.8-8.4-.8s-5.5.3-8.4.8L3 8.6z"
        fill="url(#rankCrownGloss)"
      />
      {/* Jewels */}
      <circle cx="12" cy="4.6" r="1.5" fill="#fff3c9" />
      <circle cx="3" cy="8.1" r="1.2" fill="#fff3c9" />
      <circle cx="21" cy="8.1" r="1.2" fill="#fff3c9" />
    </svg>
  );
}
