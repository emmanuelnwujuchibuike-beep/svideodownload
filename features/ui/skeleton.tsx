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

/**
 * Accessible wrapper for a skeleton region: screen readers hear "Loading…"
 * once (polite) while sighted users see the shimmer — wrap each loading.tsx
 * body in one so the loading state is announced, not silent.
 */
export function SkeletonSection({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** The standard list row: avatar + two text lines + optional trailing action. */
export function SkeletonRow({ action = true, className }: { action?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-border/60 px-3.5 py-2.5", className)} aria-hidden>
      <SkeletonAvatar />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      {action ? <Skeleton className="h-7 w-20 rounded-xl" /> : null}
    </div>
  );
}
