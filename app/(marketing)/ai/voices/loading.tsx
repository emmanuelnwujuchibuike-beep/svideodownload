import { SiteHeader } from "@/components/layout/site-header";
import { AiLibrarySkeleton } from "@/features/ai/ai-skeletons";

/**
 * Your Voices — the page's own shape while it loads (redesign page 8). Without
 * this file the nearest boundary was `/ai/loading.tsx`, the WELCOME page's
 * shape. The header is rendered here because the fallback replaces the whole
 * segment (see `/ai/loading.tsx`).
 */
export default function Loading() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}
      >
        <AiLibrarySkeleton label="Loading your voices" />
      </main>
    </>
  );
}
