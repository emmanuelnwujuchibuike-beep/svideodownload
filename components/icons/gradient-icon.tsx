"use client";

import { cloneElement, isValidElement, useId, type ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * Renders ANY monochrome icon element (the custom Frenz icon set, or a
 * lucide-react/react-icons glyph — anything that paints via `currentColor`
 * on a 24x24 viewBox) filled with the brand gradient instead of a flat
 * color — the "premium 3D" look nav destinations want on their active
 * state, without hand-redrawing every icon's geometry.
 *
 * How: the passed icon is rendered once, in solid white, purely as the
 * luminance source of an SVG `<mask>` (masks read white=visible/
 * black=hidden) — then a single gradient-filled `<rect>` is painted through
 * that mask. "Solid white" is forced via CSS inheritance (`<g
 * style={{color:"#fff"}}>`), NOT a `color` prop passed to the icon — the
 * custom Frenz icon set has no `color` prop at all (it hardcodes
 * `fill="currentColor"`/`stroke="currentColor"` and only ever exposes
 * `className`/`strokeWidth`), so a prop-based override would silently do
 * nothing for exactly the icon set this was built for. CSS inheritance
 * works identically for every icon library (Frenz, lucide, react-icons all
 * default to `currentColor`), which is why this approach is universal and
 * the prop-injection one wasn't. A nested `<svg>` inside a `<mask>` is
 * valid SVG and renders correctly in every evergreen browser. `useId` keeps
 * the gradient/mask ids collision-free if this renders more than once on a
 * page (every nav tab does).
 */
export function GradientIcon({
  icon,
  size = 24,
  className,
  from = "#0A84FF",
  to = "#6C4DFF",
}: {
  icon: ReactElement<{ className?: string }>;
  size?: number;
  className?: string;
  from?: string;
  to?: string;
}) {
  const id = useId();
  const gradId = `gi-grad-${id}`;
  const maskId = `gi-mask-${id}`;
  const source = isValidElement(icon) ? cloneElement(icon, { className: undefined }) : icon;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <mask id={maskId}>
          <g style={{ color: "#fff" }}>{source}</g>
        </mask>
      </defs>
      <rect width="24" height="24" fill={`url(#${gradId})`} mask={`url(#${maskId})`} />
    </svg>
  );
}
