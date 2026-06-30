import { cn } from "@/lib/utils";

/**
 * Base skeleton block. Use these to fill async surfaces so the user always sees
 * structure instantly instead of a blank screen or a spinner. Composes the
 * shared `shimmer` utility.
 *
 *   <Skeleton className="h-4 w-32" />
 *   <Skeleton className="aspect-video w-full rounded-xl" />
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded bg-secondary shimmer", className)} />;
}

/** Circular avatar placeholder. */
export function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-10 w-10 shrink-0 rounded-full", className)} />;
}

/** A few lines of text placeholder. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-1/2" : "w-full")} />
      ))}
    </div>
  );
}
