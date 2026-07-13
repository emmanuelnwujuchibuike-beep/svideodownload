import { cn } from "@/lib/utils";

/** Small brand-purple accent dot anchored under a top-nav icon (owner mockup). */
export function NavDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -bottom-1 left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-[hsl(var(--brand-purple))]",
        className,
      )}
    />
  );
}
