import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * FTC-style affiliate disclosure. Required wherever affiliate links render.
 * Kept tiny and unobtrusive so it doesn't hurt UX or layout.
 */
export function AffiliateDisclosure({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground/70",
        className,
      )}
    >
      <Info className="h-3 w-3 shrink-0" aria-hidden />
      <span>
        Some links are affiliate links — we may earn a commission at no extra cost to you.
      </span>
    </p>
  );
}
