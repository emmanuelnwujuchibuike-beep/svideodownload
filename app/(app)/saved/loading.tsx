import { BrandLoader } from "@/features/app-shell/brand-loader";
import { PostGridSkeleton } from "@/features/ui/page-skeletons";
import { Skeleton } from "@/features/ui/skeleton";

/**
 * Content-only skeleton for /saved. The shell (sidebar/topbar) is persistent in the
 * (app) layout, so this only fills the center column while data streams.
 */
export default function SavedLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <BrandLoader />
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-5xl">
          <Skeleton className="mb-6 h-8 w-32" />
          <PostGridSkeleton count={8} />
        </div>
      </main>
    </div>
  );
}
