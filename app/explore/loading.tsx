import { PageContainer, PostGridSkeleton, TabsSkeleton } from "@/features/ui/page-skeletons";
import { Skeleton } from "@/features/ui/skeleton";

/** Instant skeleton for /explore while the feed streams. */
export default function ExploreLoading() {
  return (
    <PageContainer>
      <Skeleton className="mb-4 h-8 w-40" />
      <TabsSkeleton count={6} />
      <PostGridSkeleton count={12} />
    </PageContainer>
  );
}
