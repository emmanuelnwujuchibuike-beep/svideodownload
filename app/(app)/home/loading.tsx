import { BrandLoader } from "@/features/app-shell/brand-loader";
import { Skeleton } from "@/features/ui/skeleton";

/**
 * Content-only skeleton for /home. The shell (sidebar/topbar) is persistent in the
 * (app) layout, so this only fills the center column + rail slot while data streams.
 */
export default function HomeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <BrandLoader />
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="space-y-6">
          {/* Greeting */}
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          {/* Stories */}
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-2.5 w-12" />
              </div>
            ))}
          </div>
          {/* Featured hero */}
          <Skeleton className="aspect-[16/10] w-full rounded-3xl sm:aspect-[21/9]" />
          {/* Reels rail */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[9/14] w-36 shrink-0 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </main>
      {/* Right rail placeholder */}
      <div className="hidden w-80 shrink-0 py-4 xl:block">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
