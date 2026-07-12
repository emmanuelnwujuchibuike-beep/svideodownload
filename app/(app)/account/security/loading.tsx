import { AppContent } from "@/features/app-shell/app-content";
import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";

/** Content-only skeleton for /account/security (shell is persistent). */
export default function SecurityLoading() {
  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <SkeletonSection label="Loading security settings">
          <div className="mb-6 flex items-center gap-3" aria-hidden>
            <Skeleton className="h-9 w-9 rounded-full" />
            <div>
              <Skeleton className="mb-2 h-7 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-border/60 p-6 last:border-0 sm:p-8">
                <Skeleton className="mb-3 h-5 w-40" />
                <Skeleton className="h-11 w-full max-w-sm rounded-2xl" />
              </div>
            ))}
          </div>
        </SkeletonSection>
      </div>
    </AppContent>
  );
}
