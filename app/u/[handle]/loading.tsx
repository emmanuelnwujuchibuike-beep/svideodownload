import { PageContainer, PostGridSkeleton } from "@/features/ui/page-skeletons";
import { Skeleton } from "@/features/ui/skeleton";

/** Instant skeleton for a public profile /u/[handle]. */
export default function ProfileLoading() {
  return (
    <PageContainer>
      {/* Profile header */}
      <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:items-end" aria-hidden>
        <Skeleton className="h-24 w-24 rounded-full sm:h-28 sm:w-28" />
        <div className="flex-1 space-y-3 text-center sm:text-left">
          <Skeleton className="mx-auto h-6 w-48 sm:mx-0" />
          <Skeleton className="mx-auto h-4 w-32 sm:mx-0" />
          <div className="flex justify-center gap-6 sm:justify-start">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>
      <PostGridSkeleton count={9} />
    </PageContainer>
  );
}
