import { Skeleton } from "@/features/ui/skeleton";

/**
 * Instant skeleton for a public profile /u/[handle]. Mirrors the live hero
 * (contained rounded banner → ring avatar → identity → stats tiles → tabs →
 * media grid) so the page appears immediately and swaps in without a layout jump.
 */
export default function ProfileLoading() {
  return (
    <main className="pb-24 pt-14 sm:pt-16">
      <span role="status" aria-live="polite" className="sr-only">
        Loading profile…
      </span>
      <div className="mx-auto max-w-4xl sm:px-4" aria-hidden>
        {/* Banner */}
        <Skeleton className="h-40 w-full rounded-none sm:h-56 sm:rounded-3xl md:h-64" />

        <div className="px-4 sm:px-6">
          {/* Avatar + actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="-mt-12 w-fit sm:-mt-20">
              <Skeleton className="h-24 w-24 rounded-full ring-4 ring-background sm:h-32 sm:w-32" />
            </div>
            <div className="flex gap-2 sm:mb-2">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-9 w-28 rounded-xl" />
            </div>
          </div>

          {/* Identity */}
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-32" />
          </div>

          {/* Stats tiles */}
          <div className="mt-5 grid grid-cols-4 gap-2.5 sm:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl sm:h-[4.5rem]" />
            ))}
          </div>

          {/* Tabs */}
          <div className="mt-8 flex gap-1.5 border-b border-border/60 pb-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-full" />
            ))}
          </div>

          {/* Media grid */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
