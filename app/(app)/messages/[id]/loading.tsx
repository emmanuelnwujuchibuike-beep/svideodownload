import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Content-only skeleton for a conversation (shell is persistent in the (app) layout). */
export default function ConversationLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="flex min-w-0 flex-1 flex-col pb-24 pt-4 lg:pb-6">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
          {/* Thread header */}
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <SkeletonAvatar className="h-10 w-10" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          {/* Bubbles */}
          <div className="flex-1 space-y-3 pt-4" aria-hidden>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className={i % 3 === 0 ? "flex justify-end" : "flex justify-start"}>
                <Skeleton className={i % 3 === 0 ? "h-9 w-44 rounded-2xl" : "h-9 w-56 rounded-2xl"} />
              </div>
            ))}
          </div>
          {/* Composer */}
          <Skeleton className="mt-4 h-12 w-full rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
