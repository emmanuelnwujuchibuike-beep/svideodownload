import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppContent } from "@/features/app-shell/app-content";

/**
 * Shared shell for a single Settings category page. Each category is its OWN
 * route (Snapchat/TikTok-style), so the settings list never packs everything on
 * one long page. A back arrow returns to the settings list; the list prefetches
 * every category, so returning and re-entering is instant.
 */
export function SettingsPage({
  title,
  description,
  children,
  bare,
  backHref = "/account",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** Skip the single card wrapper so the page can compose its own cards/groups. */
  bare?: boolean;
  /** Where the back arrow goes. Drill-down screens (a single Identity field)
   *  return to their own list, not all the way out to the settings root. */
  backHref?: string;
}) {
  return (
    <AppContent>
      {/* No extra safe-area padding here — AppTopbar (the sticky app header) already
          reserves it; adding it again doubled the top gap on notch devices. */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-3">
          <Link
            href={backHref}
            prefetch
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-[-0.02em]">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {bare ? children : <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">{children}</div>}
      </div>
    </AppContent>
  );
}
