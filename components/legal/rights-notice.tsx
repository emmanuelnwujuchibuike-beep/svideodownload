import { cn } from "@/lib/utils";

/** The owner's wording (2026-10-29, AdSense review), verbatim. One string, so every tool says exactly the same thing. */
export const RIGHTS_NOTICE =
  "Only save content you own or have permission to use. Respect the creator's rights and the platform's terms.";

/**
 * The rights notice shown directly under every download tool — the landing and /downloads paste box, and each
 * platform page's hero. Plain markup, no icon and no client JS: it sits next to the LCP area of pages held to the
 * cold-entry budget, so it must cost nothing but its text. The colour comes from the caller, because the platform
 * heroes are painted in the brand's own accent.
 */
export function RightsNotice({ className }: { className?: string }) {
  return <p className={cn("text-center text-xs font-medium leading-relaxed", className)}>{RIGHTS_NOTICE}</p>;
}
