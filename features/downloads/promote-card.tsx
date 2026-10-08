import { ArrowRight, Megaphone } from "lucide-react";
import { TapOnceLink } from "@/features/ui/tap-once-link";

import { cn } from "@/lib/utils";

/**
 * "Promote on Frenzsave" — the one advertising door in the shared download
 * hero (landing AND /downloads). Owner, 2026-10-08: "use the promote card that
 * is on the Download page to be on the landing page too … replace this fast
 * secure private card with the promote card". It sits where the trust pill
 * was, right under the headline; the pill moved below the paste box.
 * Plain navigation: no ad engine, no request (Landing brief §27).
 */
export function PromoteCard({ className }: { className?: string }) {
  return (
    <TapOnceLink
      href="/advertise"
      data-track="advertise_clicked"
      className={cn(
        "flex items-center gap-3 rounded-[1.4rem] transition-opacity data-[pending]:opacity-75 bg-card px-4 py-3 ring-1 ring-inset ring-black/[0.07] transition-colors hover:ring-indigo-200 dark:ring-white/10",
        className,
      )}
    >
      <Megaphone className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">Promote on Frenzsave</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">Put your brand in front of the Frenzsave audience.</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </TapOnceLink>
  );
}
