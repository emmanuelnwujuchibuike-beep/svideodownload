import { FeedSkeleton } from "@/features/feed/feed-skeleton";

/** Route-level skeleton shown while the home dashboard streams in. */
export default function HomeLoading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar placeholder */}
      <div className="hidden w-64 shrink-0 border-r border-border/60 bg-card/40 p-4 lg:block">
        <div className="mb-6 h-9 w-28 rounded-xl bg-secondary shimmer" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 w-full rounded-xl bg-secondary shimmer" />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border/60 px-4">
          <div className="h-10 max-w-xl flex-1 rounded-xl bg-secondary shimmer" />
          <div className="h-10 w-24 rounded-xl bg-secondary shimmer" />
        </div>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-4">
          <main className="min-w-0 flex-1 pt-4">
            <div className="mb-4 aspect-[3/1] w-full rounded-3xl bg-secondary shimmer" />
            <div className="mb-4 h-11 w-full rounded-xl bg-secondary shimmer" />
            <FeedSkeleton count={3} />
          </main>
          <div className="hidden w-80 shrink-0 py-4 xl:block">
            <div className="h-64 w-full rounded-2xl bg-secondary shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}
