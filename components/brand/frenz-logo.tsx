import { cn } from "@/lib/utils";

/**
 * The Frenz "F" mark — the single source of truth for the brand logo.
 *
 * Pure SVG (no hooks) so it's usable in both Server and Client Components and
 * stays crisp at every size. A bold gradient F with an integrated play triangle,
 * echoing the download/play identity. Use <FrenzLogo /> for the mark alone and
 * <FrenzWordmark /> for the mark + "Frenz" (no tagline).
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
          <stop stopColor="#d946ef" />
          <stop offset="0.5" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="frenz-play" x1="24" y1="28" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* F: stem + top arm + mid arm (overlapping rounded strokes) */}
      <rect x="13" y="8" width="9" height="32" rx="4.5" fill="url(#frenz-f)" />
      <rect x="13" y="8" width="25" height="9" rx="4.5" fill="url(#frenz-f)" />
      <rect x="13" y="20" width="18" height="8.5" rx="4.25" fill="url(#frenz-f)" />
      {/* Play accent */}
      <path d="M26 29.5 L38 36 L26 42.5 Z" fill="url(#frenz-play)" stroke="url(#frenz-play)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
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
