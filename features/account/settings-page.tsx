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
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** Skip the single card wrapper so the page can compose its own cards/groups. */
  bare?: boolean;
}) {
  return (
    <AppContent>
      <div className="mx-auto max-w-2xl pt-[calc(var(--frenz-safe-top))] sm:pt-0">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/account"
            prefetch
            aria-label="Back to settings"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-[-0.02em]">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {bare ? children : <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">{children}</div>}
      </div>
    </AppContent>
  );
}
