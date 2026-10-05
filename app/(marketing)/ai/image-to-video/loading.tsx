import { SiteHeader } from "@/components/layout/site-header";
import { AiToolSkeleton } from "@/features/ai/ai-skeletons";

/**
 * Part 7 §44 — the tool's own shape, not the welcome page's.
 *
 * Without this file the nearest boundary was `/ai/loading.tsx`, which draws
 * the Frenz AI welcome (hero, studio card, tool grid) — so opening this tool
 * showed the wrong page and then jumped. The header is rendered here as well
 * because the fallback replaces the whole segment (see `/ai/loading.tsx`).
 */
export default function Loading() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}
      >
        <AiToolSkeleton label="Loading Image to Video" />
      </main>
    </>
  );
}
