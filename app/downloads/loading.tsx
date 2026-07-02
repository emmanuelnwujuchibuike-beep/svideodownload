import { Skeleton } from "@/features/ui/skeleton";

/** Instant shell skeleton for /downloads while data streams. */
export default function DownloadsLoading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar placeholder */}
      <div className="hidden w-64 shrink-0 border-r border-border/60 bg-card/40 p-4 lg:block">
        <Skeleton className="mb-6 h-9 w-28 rounded-xl" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar placeholder */}
        <div className="flex h-16 items-center gap-3 border-b border-border/60 px-4">
          <Skeleton className="h-10 max-w-xl flex-1 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4">
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
      </div>
    </div>
  );
}
