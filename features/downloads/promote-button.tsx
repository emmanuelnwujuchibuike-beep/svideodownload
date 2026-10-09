import { Megaphone } from "lucide-react";

import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

/**
 * "Promote on Frenzsave" — a FIXED button (owner, 2026-10-09: "make the promote
 * button in the landing page and Download page be in a particular place, remove
 * the movement … make it have more visibility and not pure white").
 *
 * It replaces the draggable floating bubble (promote-bubble.tsx, removed), which
 * could be dropped anywhere and so could end up over the page's own controls.
 * It now has exactly two homes, both in normal flow:
 *   · /downloads — beside the credits card (`size="dock"`), as in the owner's
 *     screenshot;
 *   · the landing — in the header, beside "Install Frenz" (`size="header"`).
 *
 * A violet-tinted disc with a violet ring and a solid "PROMOTE" tag, so it reads
 * as a brand action at a glance instead of a white circle that disappears into
 * the white page. No portal, no drag, no listener of its own: the shared
 * TapOnceLink (the Earn button's), so it goes once and stays pressed while the
 * page comes.
 */
export function PromoteButton({ size = "dock", className }: { size?: "dock" | "header"; className?: string }) {
  const header = size === "header";
  return (
    <TapOnceLink
      href="/advertise"
      prefetch={false}
      // the route is warmed once the page is idle, so the first tap is not the first fetch
      warmOnIdle
      spinner={false}
      data-track="advertise_clicked"
      aria-label="Promote on Frenzsave (advertising)"
      title="Promote on Frenzsave"
      className={cn(
        "group relative flex shrink-0 items-center justify-center rounded-full text-violet-700 transition-transform active:scale-95 data-[pending]:scale-95 data-[pending]:opacity-80 motion-reduce:transition-none",
        "bg-gradient-to-br from-violet-100 via-indigo-50 to-fuchsia-100 shadow-[0_6px_14px_-8px_rgba(109,40,217,0.7)] ring-1 ring-inset ring-violet-300",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "dark:from-violet-500/25 dark:via-indigo-500/20 dark:to-fuchsia-500/25 dark:text-violet-200 dark:ring-violet-400/40",
        header ? "h-9 w-9" : "h-10 w-10",
        className,
      )}
    >
      {/* The first tap visibly responds (owner, 2026-10-09: "it suppose to respond and spin the button"):
          TapOnceLink sets data-pending at once, and CSS swaps the megaphone for a spinner on that frame. */}
      <Megaphone className={cn(header ? "h-4 w-4" : "h-[18px] w-[18px]", "group-data-[pending]:hidden")} strokeWidth={2.2} aria-hidden />
      <span
        aria-hidden
        className={cn(
          "hidden animate-spin rounded-full border-2 border-current border-t-transparent group-data-[pending]:inline-block motion-reduce:animate-none",
          header ? "h-3.5 w-3.5" : "h-4 w-4",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-1 py-px font-extrabold uppercase leading-none tracking-wide text-white ring-1 ring-white dark:ring-slate-900",
          header ? "-bottom-1.5 text-[6.5px]" : "-bottom-1.5 text-[7px]",
        )}
      >
        Promote
      </span>
    </TapOnceLink>
  );
}
