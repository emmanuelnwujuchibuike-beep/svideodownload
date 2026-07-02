import { PageContainer, PostGridSkeleton } from "@/features/ui/page-skeletons";
import { Skeleton } from "@/features/ui/skeleton";

/** Instant skeleton for /saved. */
export default function SavedLoading() {
  return (
    <PageContainer>
      <Skeleton className="mb-5 h-8 w-32" />
      <PostGridSkeleton count={8} />
    </PageContainer>
  );
}
