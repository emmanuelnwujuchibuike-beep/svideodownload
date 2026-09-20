import { SiteHeader } from "@/components/layout/site-header";
import { CharacterReplaceCreateSkeleton } from "@/features/ai/ai-skeletons";

/** The header and the create page's strip skeleton while the route streams (owner, 2026-09-20). */
export default function Loading() {
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <CharacterReplaceCreateSkeleton />
      </main>
    </>
  );
}
