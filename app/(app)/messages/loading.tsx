import { BrandLoader } from "@/features/app-shell/brand-loader";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Inbox skeleton — fills the Glass Split panel (mobile list / desktop empty state). */
export default function MessagesLoading() {
  return (
    <div className="flex-1 overflow-hidden px-3 pt-4 lg:px-6">
      <BrandLoader />
      <Skeleton className="mb-4 h-8 w-36 lg:hidden" />
      <div className="space-y-1 lg:hidden" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl p-3">
            <SkeletonAvatar className="h-12 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
      <div className="hidden h-full items-center justify-center lg:flex" aria-hidden>
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    </div>
  );
}
