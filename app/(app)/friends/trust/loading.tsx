import { AppContent } from "@/features/app-shell/app-content";
import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";

/** Content-only skeleton for /friends/trust (shell is persistent). */
export default function TrustCenterLoading() {
  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <SkeletonSection label="Loading Trust Center">
          <div className="mb-6 flex items-center gap-3" aria-hidden>
            <Skeleton className="h-9 w-9 rounded-full" />
            <div>
              <Skeleton className="mb-2 h-7 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
          <Skeleton className="mt-4 h-32 w-full rounded-3xl" />
        </SkeletonSection>
      </div>
    </AppContent>
  );
}
