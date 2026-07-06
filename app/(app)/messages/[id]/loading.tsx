import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Thread skeleton — fills the Glass Split right panel. */
export default function ConversationLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <span role="status" aria-live="polite" className="sr-only">
        Loading conversation…
      </span>
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
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
