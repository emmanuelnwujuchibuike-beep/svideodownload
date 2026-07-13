import { AppContent } from "@/features/app-shell/app-content";
import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";

/** Content-only skeleton for /account/appeals (shell is persistent). */
export default function AppealsLoading() {
  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <SkeletonSection label="Loading appeals">
          <div className="mb-6 flex items-center gap-3" aria-hidden>
            <Skeleton className="h-9 w-9 rounded-full" />
            <div>
              <Skeleton className="mb-2 h-7 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card p-5">
            <Skeleton className="mb-3 h-5 w-32" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </SkeletonSection>
      </div>
    </AppContent>
  );
}
