import { BrandLoader } from "@/features/app-shell/brand-loader";
import { Skeleton } from "@/features/ui/skeleton";

/**
 * Content-only skeleton for /downloads. The shell is persistent in the (app)
 * layout, so this only fills the center column + rail slot while data streams.
 */
export default function DownloadsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <BrandLoader />
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        {/* Paste box */}
        <Skeleton className="mb-6 h-28 w-full rounded-3xl" />
        {/* Stats row */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        {/* Downloaded list */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      </main>
      <div className="hidden w-80 shrink-0 py-4 xl:block">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
