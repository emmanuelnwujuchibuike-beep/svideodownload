import { cn } from "@/lib/utils";

/**
 * The Frenz "F" mark — the single source of truth for the brand logo.
 *
 * A premium, luxury F: a bold rounded letterform in an indigo→violet→fuchsia
 * gradient with a subtle glossy highlight and a sparkle accent. Pure SVG (no
 * hooks) so it works in Server and Client Components and stays crisp at any size.
 * <FrenzLogo /> = the mark alone · <FrenzMark /> = the mark inside a luxury tile ·
 * <FrenzWordmark /> = mark + "Frenz".
 */
export function FrenzLogo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Frenz"
    >
      <defs>
        <linearGradient id="frenz-f" x1="10" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="0.52" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#D946EF" />
        </linearGradient>
        <linearGradient id="frenz-gloss" x1="14" y1="7" x2="14" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* F — stem + top arm + mid arm, all rounded, one gradient */}
      <rect x="14.5" y="7" width="8.5" height="34" rx="4.25" fill="url(#frenz-f)" />
      <rect x="14.5" y="7" width="25.5" height="8.5" rx="4.25" fill="url(#frenz-f)" />
      <rect x="14.5" y="19.5" width="18.5" height="8" rx="4" fill="url(#frenz-f)" />
      {/* Glossy highlight down the stem for a premium sheen */}
      <rect x="16.4" y="8.6" width="3" height="16" rx="1.5" fill="url(#frenz-gloss)" />

      {/* Luxury 4-point sparkle */}
      <path
        d="M36.4 19.6 l1.15 2.55 2.55 1.15 -2.55 1.15 -1.15 2.55 -1.15 -2.55 -2.55 -1.15 2.55 -1.15 z"
        fill="#22D3EE"
      />
    </svg>
  );
}

/**
 * The mark inside a soft white rounded tile with a glow — the "app icon" lockup
 * used as a hero (e.g. the login collage centerpiece).
 */
export function FrenzMark({ className, size = 72 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-[28%] bg-white shadow-[0_18px_50px_-12px_rgba(124,58,237,0.55)] ring-1 ring-black/5",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <FrenzLogo size={Math.round(size * 0.62)} />
    </span>
  );
}

/** The mark + "Frenz" wordmark (no tagline). Default brand lockup across the app. */
export function FrenzWordmark({
  className,
  size = 30,
  textClassName,
}: {
  className?: string;
  size?: number;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold", className)}>
      <FrenzLogo size={size} />
      <span className={cn("text-gradient text-[17px] tracking-tight", textClassName)}>Frenz</span>
    </span>
  );
}
