import { PageContainer } from "@/features/ui/page-skeletons";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Instant skeleton for /account. */
export default function AccountLoading() {
  return (
    <PageContainer>
      <div className="mb-6 flex items-center gap-4" aria-hidden>
        <SkeletonAvatar className="h-16 w-16" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </div>
      <div className="space-y-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </PageContainer>
  );
}
