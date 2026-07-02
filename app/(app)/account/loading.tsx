import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Content-only skeleton for /account (shell is persistent in the (app) layout). */
export default function AccountLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="mb-8 h-9 w-48" />
          <div className="mb-6 flex items-center gap-4" aria-hidden>
            <SkeletonAvatar className="h-16 w-16" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          <div className="space-y-4" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
