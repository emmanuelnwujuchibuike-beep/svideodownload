import { Skeleton, SkeletonAvatar, SkeletonSection } from "@/features/ui/skeleton";

/** Layout-matched skeleton for /friends/discover (shell stays persistent). */
export default function DiscoverLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pb-24 pt-4 sm:px-4 lg:pb-6">
      <SkeletonSection label="Loading suggestions">
        <Skeleton className="mb-2 h-8 w-40" />
        <Skeleton className="mb-3 h-4 w-64" />
        {/* Search bar */}
        <Skeleton className="mb-4 h-12 w-full rounded-2xl" />
        {/* People-you-may-know grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 rounded-3xl border border-border/60 p-4" aria-hidden>
              <SkeletonAvatar className="h-16 w-16" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </SkeletonSection>
    </div>
  );
}
