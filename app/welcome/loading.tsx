import { Skeleton, SkeletonAvatar, SkeletonSection } from "@/features/ui/skeleton";

/** Layout-matched skeleton for /welcome (split hero + setup form). */
export default function WelcomeLoading() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand aside (desktop) — solid brand wash, no content flash */}
      <aside aria-hidden className="hidden bg-gradient-to-br from-blue-600 via-violet-600 to-purple-700 lg:block" />
      <div className="flex items-center justify-center px-5 py-10">
        <SkeletonSection label="Loading account setup" className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <SkeletonAvatar className="h-20 w-20" />
          </div>
          <Skeleton className="mx-auto mb-2 h-7 w-56" />
          <Skeleton className="mx-auto mb-8 h-4 w-72" />
          <div className="space-y-3">
            <Skeleton className="h-[52px] w-full rounded-2xl" />
            <Skeleton className="h-[52px] w-full rounded-2xl" />
            <Skeleton className="h-[52px] w-full rounded-2xl" />
          </div>
        </SkeletonSection>
      </div>
    </main>
  );
}
