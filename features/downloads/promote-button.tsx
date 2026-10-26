import { Megaphone } from "lucide-react";

import { IconTile } from "@/components/icons/icon-tile";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

/**
 * "My ads" — the advertiser's door in the top header.
 *
 * History: 2026-10-15 a glass text pill ("remove the circle background … leave just the icon and the my ads text").
 * 2026-10-25 (owner): "Change the my ad button to just the ad icon" — the megaphone alone, set into the header like the
 * search and bell icons (the shared IconTile: same 44 px target, same lifted glyph), its violet kept so it still reads
 * as the advertiser's door. The words live on as the accessible name and the tooltip.
 *
 * Two homes, both headers, both in normal flow:
 *   · /downloads — the app top bar (app-topbar.tsx);
 *   · the landing — the site header (site-header.tsx).
 *
 * It opens the advertiser's own campaigns (/advertise/campaigns). The shared TapOnceLink answers the first tap at once
 * — pressed, and the megaphone becomes a spinner on that frame — and the route is warmed once the page is idle.
 */
export function PromoteButton({ className }: { size?: "dock" | "header"; className?: string }) {
  return (
    <TapOnceLink
      href="/advertise/campaigns"
      prefetch={false}
      warmOnIdle
      spinner={false}
      data-track="advertise_clicked"
      aria-label="My ads"
      title="My ads"
      className={cn(
        "group inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-transform active:scale-90 data-[pending]:scale-95 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <IconTile>
        <Megaphone className="h-[22px] w-[22px] text-violet-600 group-data-[pending]:hidden dark:text-violet-300" strokeWidth={2.2} aria-hidden />
        <span aria-hidden className="hidden h-[18px] w-[18px] animate-spin rounded-full border-2 border-violet-600 border-t-transparent group-data-[pending]:inline-block motion-reduce:animate-none dark:border-violet-300 dark:border-t-transparent" />
      </IconTile>
    </TapOnceLink>
  );
}
