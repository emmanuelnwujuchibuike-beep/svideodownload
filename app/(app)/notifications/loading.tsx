import { BrandLoader } from "@/features/app-shell/brand-loader";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Content-only skeleton for /notifications (shell is persistent in the (app) layout). */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <BrandLoader />
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="mb-5 h-9 w-52" />
          <div className="mb-5 flex gap-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <div className="space-y-2.5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5 rounded-3xl border border-border/60 p-3.5">
                <SkeletonAvatar className="h-12 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
