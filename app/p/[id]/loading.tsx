import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Skeleton for the standalone post viewer so deep links paint instantly. */
export default function PostLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-16 pt-6 sm:px-4">
      <div className="mb-4 flex items-center gap-3" aria-hidden>
        <SkeletonAvatar className="h-11 w-11" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mb-4 aspect-video w-full rounded-2xl" />
      <div className="mb-6 flex gap-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <SkeletonAvatar className="h-8 w-8" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
