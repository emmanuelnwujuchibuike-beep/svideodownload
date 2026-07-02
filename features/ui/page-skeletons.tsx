import type { ReactNode } from "react";

import { Skeleton } from "@/features/ui/skeleton";

/**
 * Reusable route-level skeletons. Rendered by each route's `loading.tsx` so
 * navigation paints an instant placeholder (Next.js streams the loading boundary
 * on click) instead of a frozen screen while the server renders. Server-safe.
 */

/** Grid of post/media cards (Explore, Saved, profile posts). */
export function PostGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Spacer that clears the fixed SiteHeader (h-16) on marketing-chrome pages. */
export function HeaderSpacer() {
  return <div aria-hidden className="h-16" />;
}

/** A centered content column matching the marketing-chrome container width. */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <HeaderSpacer />
      <div className="container py-6">{children}</div>
    </div>
  );
}

/** Row of pill/tab placeholders. */
export function TabsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="mb-5 flex gap-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-full" />
      ))}
    </div>
  );
}
