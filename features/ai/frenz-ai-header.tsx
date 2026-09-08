import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The header every Frenz AI screen opens with.
 *
 * ── The hierarchy it exists to make visible ───────────────────────────────────
 * Frenzsave → Frenz Studio → Frenz AI → a tool. A member arriving on AI Clean
 * should be able to see where they are without reading a word of body copy, so
 * the eyebrow row carries the ecosystem mark and the tool's own name sits on it
 * as a crumb that walks back up.
 *
 * On the hub itself there is no crumb, and the eyebrow is not a link — a link to
 * the page you are already on is a dead tap, which this project has removed from
 * three other surfaces already ([[search-explore-redesign-2026-08-24]]).
 *
 * A server component: it renders text and one link. Everything that needs a
 * click handler is passed in through `action`.
 */
export function FrenzAIHeader({
  crumb,
  title,
  description,
  badge,
  action,
  className,
}: {
  /** The tool's name, e.g. "AI Clean". Omitted on the hub. */
  crumb?: string;
  title: string;
  description: string;
  /** Usually the Pro pill. Sits beside the crumb, not the heading. */
  badge?: ReactNode;
  /** Right-aligned control — the tutorial replay on AI Clean. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {crumb ? (
              <Link
                href="/studio/ai"
                prefetch
                className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <MarkTile />
                Frenz AI
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MarkTile />
                Frenz AI
              </span>
            )}
            {crumb ? (
              <>
                <span aria-hidden className="text-xs text-muted-foreground/50">
                  /
                </span>
                <span className="text-xs font-semibold text-foreground">{crumb}</span>
              </>
            ) : null}
            {badge}
          </div>

          <h1 className="mt-2.5 text-[1.6rem] font-bold leading-[1.15] tracking-[-0.03em] sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

/**
 * The little gradient chip in front of the wordmark. `.bg-brand-tile` is the
 * app's shared icon-tile gradient (deep indigo → deep purple), so this reads as
 * part of Frenz rather than as a new brand — and it is the same tile the module
 * headers, nav tabs and topbar actions already use.
 */
function MarkTile() {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 items-center justify-center rounded-[7px] bg-brand-tile text-white shadow-sm"
    >
      <Sparkles className="h-3 w-3" />
    </span>
  );
}
