import { BrandLoader } from "@/features/app-shell/brand-loader";
import { PostGridSkeleton, TabsSkeleton } from "@/features/ui/page-skeletons";
import { Skeleton } from "@/features/ui/skeleton";

/** Content-only skeleton for /explore (shell is persistent in the (app) layout). */
export default function ExploreLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <BrandLoader />
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-5xl">
          <Skeleton className="mb-2 h-8 w-40" />
          <Skeleton className="mb-6 h-4 w-72" />
          <TabsSkeleton count={2} />
          <TabsSkeleton count={6} />
          <PostGridSkeleton count={12} />
        </div>
      </main>
    </div>
  );
}
