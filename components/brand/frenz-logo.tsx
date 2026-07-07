import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The Frenz "F" mark — the single source of truth for the brand logo.
 *
 * Real artwork, not a hand-drawn glyph: a glass/gradient F with an integrated
 * play-triangle notch on its own rounded-square tile (`public/brand/frenz-icon-master.png`,
 * cropped tight from the delivered source). This one file is now what renders
 * everywhere the brand mark appears — favicon, apple-touch-icon, PWA manifest
 * icons, the push-notification icon, the Open Graph/Twitter share card, and
 * every in-app usage below — so there is exactly one logo asset in the whole
 * product. The un-cropped delivered artwork lives at
 * `public/brand/frenz-mark-source.jpg` and the icon+wordmark lockup at
 * `public/brand/frenz-lockup-master.png`, kept for future re-exports.
 *
 * <FrenzLogo /> = the mark alone · <FrenzMark /> = the mark with a drop shadow ·
 * <FrenzWordmark /> = mark + "Frenz".
 */
export function FrenzLogo({
  className,
  size = 32,
  priority = false,
}: {
  className?: string;
  size?: number;
  /** Set true for chrome that's always visible immediately (persistent nav,
   * full-page splash) — everywhere else it lazy-loads like any other image. */
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/frenz-icon-master.png"
      alt="Frenz"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 rounded-[22%]", className)}
    />
  );
}

/** The mark with a soft brand-colored drop shadow — used as a hero (e.g. the login collage centerpiece). */
export function FrenzMark({
  className,
  size = 72,
  priority,
}: {
  className?: string;
  size?: number;
  priority?: boolean;
}) {
  return (
    <FrenzLogo
      size={size}
      priority={priority}
      className={cn("shadow-[0_18px_50px_-12px_rgba(124,58,237,0.55)]", className)}
    />
  );
}

/** The mark + "Frenz" wordmark (no tagline). Default brand lockup across the app. */
export function FrenzWordmark({
  className,
  size = 30,
  textClassName,
  priority,
}: {
  className?: string;
  size?: number;
  textClassName?: string;
  priority?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold", className)}>
      <FrenzLogo size={size} priority={priority} />
      <span className={cn("text-gradient text-[17px] tracking-tight", textClassName)}>Frenz</span>
    </span>
  );
}
