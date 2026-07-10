import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The Frenz "F" mark — the single source of truth for the brand logo.
 *
 * Two square exports of the same real artwork (a glass/gradient F with an
 * integrated play-triangle notch):
 *  • `public/brand/frenz-logo.png` — TRANSPARENT background. The default, used
 *    everywhere the mark sits on the app's own surfaces: marketing header/footer,
 *    loaders, the pull-to-refresh spinner, the favicon, the email, and the
 *    Open Graph / share cards. It adapts to whatever's behind it.
 *  • `public/brand/frenz-logo-tile.png` — the same F on its dark navy tile
 *    (opaque). Used via `tile` for the in-app "webapp logo" (the sidebar) so it
 *    reads like the installed app icon, and it's the source for the PWA / iOS /
 *    maskable home-screen icons (which must be opaque).
 *
 * <FrenzLogo /> = the mark alone · <FrenzMark /> = the mark with a drop shadow ·
 * <FrenzWordmark /> = mark + "Frenz". Pass `tile` to any of them for the
 * dark-tiled app-icon variant.
 */
export function FrenzLogo({
  className,
  size = 32,
  priority = false,
  tile = false,
}: {
  className?: string;
  size?: number;
  /** Set true for chrome that's always visible immediately (persistent nav,
   * full-page splash) — everywhere else it lazy-loads like any other image. */
  priority?: boolean;
  /** Use the dark-tiled (opaque, app-icon-style) mark instead of the
   * transparent one — for the in-app webapp logo and anywhere a logo suits a
   * background. */
  tile?: boolean;
}) {
  return (
    <Image
      src={tile ? "/brand/frenz-logo-tile.png" : "/brand/frenz-logo.png"}
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
  tile = false,
}: {
  className?: string;
  size?: number;
  priority?: boolean;
  tile?: boolean;
}) {
  return (
    <FrenzLogo
      size={size}
      priority={priority}
      tile={tile}
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
  tile = false,
}: {
  className?: string;
  size?: number;
  textClassName?: string;
  priority?: boolean;
  /** Dark-tiled app-icon mark — for the in-app webapp logo (sidebar). */
  tile?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold", className)}>
      <FrenzLogo size={size} priority={priority} tile={tile} />
      <span className={cn("text-gradient text-[17px] tracking-tight", textClassName)}>Frenz</span>
    </span>
  );
}
