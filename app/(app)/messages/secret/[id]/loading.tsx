import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Secret Chat thread skeleton — mirrors messages/[id]/loading.tsx. */
export default function SecretChatLoading() {
  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:flex-1">
      <span role="status" aria-live="polite" className="sr-only">
        Loading Secret Chat…
      </span>
      <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3">
        <SkeletonAvatar className="h-9 w-9" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-hidden p-4" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={i % 3 === 0 ? "flex justify-end" : "flex justify-start"}>
            <Skeleton className={i % 3 === 0 ? "h-9 w-40 rounded-2xl" : "h-9 w-52 rounded-2xl"} />
          </div>
        ))}
      </div>
      <div className="border-t border-border/60 p-3">
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
    </div>
  );
}
