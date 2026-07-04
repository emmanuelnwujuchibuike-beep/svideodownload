import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Content-only skeleton for /friends (shell is persistent in the (app) layout). */
export default function FriendsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto w-full max-w-2xl">
          <Skeleton className="mb-5 h-8 w-32" />
          <Skeleton className="mb-2.5 h-4 w-36" />
          <div className="mb-7 space-y-2.5" aria-hidden>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 rounded-3xl border border-border/60 p-4">
                <SkeletonAvatar className="h-12 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-44" />
                  <Skeleton className="h-9 w-full rounded-2xl" />
                  <Skeleton className="h-8 w-40 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="mb-2.5 h-4 w-28" />
          <div className="space-y-1.5" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/60 px-3.5 py-2.5">
                <SkeletonAvatar className="h-10 w-10" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-7 w-20 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
