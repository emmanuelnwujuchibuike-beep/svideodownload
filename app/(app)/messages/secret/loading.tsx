import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/** Secret Chats list skeleton — mirrors messages/loading.tsx's inbox skeleton. */
export default function SecretChatsLoading() {
  return (
    <div className="flex-1 overflow-hidden px-3 pt-4 lg:px-6">
      <span role="status" aria-live="polite" className="sr-only">
        Loading Secret Chats…
      </span>
      <Skeleton className="mb-4 h-8 w-36" />
      <div className="space-y-1" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl p-3">
            <SkeletonAvatar className="h-12 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
