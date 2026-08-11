import { PLATFORM_STATUS_META, type PlatformStatus } from "@/lib/platform-status";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STATUS TICK ON A PLATFORM LOGO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: "a small green and yellow and red tick at the top of every
 * support platform logo … make the tick professional and organised."
 *
 * ── Why it is a dot on a ring and not a coloured check glyph ───────────────
 *
 * A tick MARK means "yes" — so a red tick is a contradiction, and an amber one
 * is unreadable. What is wanted is a status LIGHT, which is the shape every
 * status page and every OS presence indicator already uses, so nobody has to
 * learn it. The white ring is what keeps it legible on a brand tile of any
 * colour, including the ones this app has that are black (TikTok) and yellow
 * (Snapchat) — a bare dot vanishes on one of those.
 *
 * ── 🔴 Green is deliberately SILENT ────────────────────────────────────────
 *
 * `operational` renders NOTHING by default. If every logo carries a green dot,
 * eight green dots become wallpaper and the one amber dot that matters is lost
 * in them — the badge stops being an alert and becomes decoration. Absence is
 * the healthy state, which is also how a page with nothing wrong should look.
 * `showHealthy` forces it on for the admin panel, where a green dot IS the
 * information ("I have looked at this one").
 *
 * ── Accessibility ─────────────────────────────────────────────────────────
 *
 * A colour alone is not a status. Each dot carries an accessible name naming
 * the platform AND the state in words, so a screen reader gets "TikTok: not
 * working" and a viewer who cannot separate red from green gets it from the
 * tooltip. `title` covers the pointer case.
 */
export function PlatformStatusDot({
  status,
  platformName,
  showHealthy = false,
  size = "md",
  className,
}: {
  status: PlatformStatus;
  /** Named in the accessible label — "TikTok: not working". */
  platformName: string;
  /** Render the green dot too. Off by default; see the note above. */
  showHealthy?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (status === "operational" && !showHealthy) return null;
  const meta = PLATFORM_STATUS_META[status];
  const px = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  return (
    <span
      role="img"
      aria-label={`${platformName}: ${meta.label}`}
      title={`${platformName} — ${meta.label}. ${meta.description}`}
      className={cn(
        // Positioned by the CALLER's `relative` parent. Nudged outside the tile's
        // corner rather than sitting inside it, so it never covers the logo it is
        // describing — the mark stays the thing you recognise.
        "pointer-events-none absolute -right-0.5 -top-0.5 z-10 rounded-full ring-2 ring-white shadow-sm dark:ring-neutral-900",
        px,
        meta.dot,
        className,
      )}
    />
  );
}

/**
 * The same state as a labelled chip, for places with room for words — the admin
 * panel and the status list. Colour is never the only channel here either.
 */
export function PlatformStatusChip({ status, className }: { status: PlatformStatus; className?: string }) {
  const meta = PLATFORM_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        meta.text,
        meta.ring,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.short}
    </span>
  );
}
