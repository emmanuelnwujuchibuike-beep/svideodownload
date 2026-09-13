import { SiteHeader } from "@/components/layout/site-header";
import { CharacterReplaceSkeleton } from "@/features/ai/ai-skeletons";

/**
 * The tap has to answer, even when the route cannot yet — see the note on
 * the AI history loading file. Header here too, so the fallback does not
 * drop it for the length of the load and bring it back.
 */
export default function Loading() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}
      >
        <CharacterReplaceSkeleton />
      </main>
    </>
  );
}
