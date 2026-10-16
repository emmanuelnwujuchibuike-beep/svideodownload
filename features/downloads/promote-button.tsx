import { Megaphone } from "lucide-react";

import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

/**
 * "My ads" — the advertiser's door, a glass text pill set into the top header
 * (owner, 2026-10-15, with a screenshot of the old violet disc tagged PROMOTE:
 * "Change this button to my ads and move it to the top header, and remove the
 * circle background, only make the text background glass and embedded on the
 * top header"; then: "Don't remove the promote icon … just remove the circle background and
 * leave just the icon and the my ads text"). The megaphone stays, in its violet, beside the
 * words — no disc behind it.
 *
 * Two homes, both headers, both in normal flow:
 *   · /downloads — the app top bar, beside Install / Add friend (app-topbar.tsx);
 *   · the landing — the site header, beside "Install Frenz" (site-header.tsx).
 * The disc that sat in the /downloads hero is gone.
 *
 * It opens the advertiser's own campaigns (/advertise/campaigns), which offers
 * creating a first ad to someone who has none. No portal, no drag, no listener
 * of its own: the shared TapOnceLink (the Earn button's), so the first tap
 * responds at once — pressed and a spinner on that frame — and the route is
 * warmed once the page is idle.
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
        "group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] sm:px-3.5 font-bold text-foreground transition-transform active:scale-95 data-[pending]:scale-95 data-[pending]:opacity-80 motion-reduce:transition-none",
        // glass: see-through, blurred, a hairline edge and a soft top highlight — set into the header, not floating on it
        "bg-white/45 ring-1 ring-inset ring-black/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl backdrop-saturate-150",
        "dark:bg-white/[0.08] dark:ring-white/15 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <Megaphone className="h-4 w-4 text-violet-600 group-data-[pending]:hidden dark:text-violet-300" strokeWidth={2.2} aria-hidden />
      <span aria-hidden className="hidden h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent group-data-[pending]:inline-block motion-reduce:animate-none" />
      My ads
    </TapOnceLink>
  );
}
