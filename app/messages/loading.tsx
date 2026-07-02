import { PageContainer } from "@/features/ui/page-skeletons";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Instant skeleton for the /messages conversation list. */
export default function MessagesLoading() {
  return (
    <PageContainer>
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
    </PageContainer>
  );
}
