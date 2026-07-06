import { Skeleton, SkeletonRow, SkeletonSection } from "@/features/ui/skeleton";

/** Layout-matched skeleton for the followers list (shell stays persistent). */
export default function FollowersLoading() {
  return (
    <main className="container max-w-2xl pb-24 pt-28 sm:pt-32 lg:pt-8">
      <SkeletonSection label="Loading followers">
        <Skeleton className="mb-1.5 h-7 w-40" />
        <Skeleton className="mb-6 h-3.5 w-24" />
        <div className="space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </SkeletonSection>
    </main>
  );
}
