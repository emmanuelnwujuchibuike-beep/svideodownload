import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Content-only skeleton for /messages (shell is persistent in the (app) layout). */
export default function MessagesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="mb-5 h-8 w-36" />
          <div className="space-y-1" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl p-3">
                <SkeletonAvatar className="h-12 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
