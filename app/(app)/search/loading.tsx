import { Skeleton } from "@/features/ui/skeleton";

/** Content-only skeleton for /search (shell persists in the (app) layout). */
export default function SearchLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="mb-5 h-12 w-full rounded-full" />
          <div className="mb-5 flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
