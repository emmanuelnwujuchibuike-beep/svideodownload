import { Skeleton } from "@/features/ui/skeleton";

/** Content-only skeleton for /account/analytics (shell is persistent). */
export default function AnalyticsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="mb-5 h-8 w-44" />
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="mb-4 h-64 w-full rounded-2xl" />
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
