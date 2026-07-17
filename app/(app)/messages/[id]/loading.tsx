import { WarmThreadPreview } from "@/features/social/warm-thread-preview";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/**
 * Thread loading state — fills the Glass Split right panel.
 *
 * Paints the WARMED thread when the inbox has already peeked it, and only falls
 * back to the skeleton below when it hasn't (cold start, a chat outside the
 * warmed top 10, a hard reload).
 *
 * This file is the ONLY place that can remove the entry wait: it's the one thing
 * that renders BEFORE the RSC round trip. The page itself is an async server
 * component, so by the time it can read the warm cache, the server has already
 * re-sent the same data. See WarmThreadPreview's doc comment.
 */
export default function ConversationLoading() {
  return <WarmThreadPreview fallback={<ThreadSkeleton />} />;
}

function ThreadSkeleton() {
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
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-3">
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
