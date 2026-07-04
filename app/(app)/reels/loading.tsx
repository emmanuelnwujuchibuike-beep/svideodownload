import { BrandLoader } from "@/features/app-shell/brand-loader";
import { Skeleton } from "@/features/ui/skeleton";

/** Full-screen reel skeleton for /reels — dark chrome (action rail + caption)
 *  with the shimmering brand F. No spinner. */
export default function ReelsLoading() {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black" aria-hidden>
      {/* Reel chrome skeleton */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute bottom-24 right-3 flex flex-col items-center gap-5 sm:bottom-8">
          <Skeleton className="h-11 w-11 rounded-full bg-white/10" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-12 rounded-full bg-white/10" />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 space-y-2 px-4 pb-24 sm:pb-8">
          <Skeleton className="h-4 w-40 bg-white/10" />
          <Skeleton className="h-3 w-64 bg-white/10" />
        </div>
      </div>

      {/* Shimmering brand F */}
      <BrandLoader size={64} delayMs={0} overlay={false} />
    </div>
  );
}
