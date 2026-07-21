import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/**
 * Thread skeleton — fills the Glass Split right panel.
 *
 * REVERTED 2026-07-17: this briefly rendered `WarmThreadPreview` (the warm cache
 * painted during the route transition, to kill the grey entry). It shipped a
 * far worse bug — owner: "when i enter a chat it glitchs and show a wrong chat
 * for 1 sec before showing the real chat". `loading.tsx` gets no `params`, so the
 * preview resolved the conversation id from `usePathname()`, and during a route
 * transition that does not reliably read as the INCOMING chat — so it painted the
 * PREVIOUS conversation's messages. Showing one person's chat inside another's is
 * unacceptable regardless of how brief it is, and it is not a styling nit to be
 * tuned: a route-transition-time preview needs an id it can TRUST.
 *
 * The underlying problem is still real and still open (the warm-up is inert
 * because /messages/[id] is an async server page — see [[open-work-2026-07-17]]).
 * The fix must get the id from something authoritative for the INCOMING route,
 * not from a hook that lags the transition.
 */
export default function ConversationLoading() {
  return (
    // Matches [id]/page.tsx's mobile full-viewport overlay exactly (same
    // fixed/z-50/lg: split) — otherwise the skeleton renders in-flow below
    // the topbar and the real page snaps to fixed-fullscreen the instant it
    // streams in, a jarring layout jump.
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:flex-1 lg:bg-transparent">
      <span role="status" aria-live="polite" className="sr-only">
        Loading conversation…
      </span>
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 pt-[calc(0.75rem+var(--frenz-safe-top))] lg:pt-3">
        <SkeletonAvatar className="h-10 w-10" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      {/* Bubbles */}
      <div className="flex-1 space-y-3 overflow-hidden p-4" aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={i % 3 === 0 ? "flex justify-end" : "flex justify-start"}>
            <Skeleton className={i % 3 === 0 ? "h-9 w-44 rounded-3xl" : "h-9 w-56 rounded-3xl"} />
          </div>
        ))}
      </div>
      {/* Composer */}
      <div className="border-t border-border/60 p-3">
        <Skeleton className="h-11 w-full rounded-2xl" />
      </div>
    </div>
  );
}
