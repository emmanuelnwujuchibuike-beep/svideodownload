import { Skeleton } from "@/features/ui/skeleton";

/**
 * Instant skeleton for a public profile /u/[handle]. Mirrors the live hero
 * (banner → ring avatar → identity → stats tiles → tabs → media grid) so the
 * page appears immediately and swaps to real content without a layout jump.
 */
export default function ProfileLoading() {
  return (
    <main className="pb-24 pt-16" aria-hidden>
      {/* Banner */}
      <Skeleton className="h-40 w-full rounded-none sm:h-52" />

      <div className="container max-w-3xl">
        {/* Avatar + actions */}
        <div className="flex items-end justify-between">
          <div className="-mt-12 sm:-mt-16">
            <Skeleton className="h-24 w-24 rounded-full ring-4 ring-background sm:h-28 sm:w-28" />
          </div>
          <div className="mb-2 flex gap-2">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>

        {/* Identity */}
        <div className="mt-4 space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Stats tiles */}
        <div className="mt-5 grid grid-cols-4 gap-2 sm:max-w-md">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-8 flex gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>

        {/* Media grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-2xl" />
          ))}
        </div>
      </div>
    </main>
  );
}
