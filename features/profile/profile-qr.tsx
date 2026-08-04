import { encodeQr } from "@/lib/qr/encode";
import { matrixPath, QUIET_ZONE } from "@/lib/qr/svg";
import { cn } from "@/lib/utils";

/**
 * A profile's QR code, rendered as a real `<svg>` element.
 *
 * ── Server component, no client JavaScript ───────────────────────────────
 * A QR is a pure function of a URL that never changes while the page is open.
 * Generating it on the server means the picture is already in the HTML — no
 * hydration, no layout shift when it appears, and it works with JavaScript
 * off. It is also the only way it can be part of a static or streamed render
 * rather than a hole that fills in late.
 *
 * ── Why not `dangerouslySetInnerHTML` with the markup string ──────────────
 * `lib/qr/svg.ts` can produce complete markup, and using it here would be one
 * line. But injecting raw HTML for something a member's own data feeds is the
 * habit that eventually ships an injection bug, even when today's input is our
 * own URL. React builds the element from the path data instead, so the content
 * is always data and never markup.
 *
 * The code is generated locally and never leaves this server — no QR service
 * sees who is sharing which profile.
 */
export function ProfileQr({
  value,
  label,
  className,
  size = 220,
}: {
  /** The URL to encode. */
  value: string;
  /** Accessible label. Omit for a decorative code beside visible text. */
  label?: string;
  className?: string;
  size?: number;
}) {
  let extent: number;
  let path: string;
  try {
    const matrix = encodeQr(value);
    extent = matrix.size + QUIET_ZONE * 2;
    path = matrixPath(matrix);
  } catch {
    // Only reachable if a URL somehow exceeded 213 bytes. A missing code is
    // recoverable — the page still shows the link and the copy button — where
    // a thrown error would take the whole profile down with it.
    return null;
  }

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn("h-auto w-full max-w-[260px]", className)}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* The quiet zone is part of the viewBox, so this white field must cover
          the whole extent — a QR printed flush to a coloured edge does not
          scan, and that is the most common reason a hand-made one fails. */}
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#111827" />
    </svg>
  );
}
