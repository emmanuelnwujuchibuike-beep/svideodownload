import { SiteHeader } from "@/components/layout/site-header";
import { AICleanSkeleton } from "@/features/ai/ai-skeletons";

/**
 * ── 🔴 THE TAP HAS TO ANSWER, EVEN WHEN THE ROUTE CANNOT YET ───────────────
 *
 * Owner, 2026-09-09: "the Frenz AI button still doesn't respond instantly. If
 * it haven't prefetch it should respond instantly and show the strip header
 * skeleton loader while it opens instantly, so users don't click twice."
 *
 * Exactly right, and the cause was structural rather than slow: NONE of the
 * public /ai routes had a . Without one Next has no Suspense
 * boundary to fall back to, so a navigation BLOCKS on the server response and
 * the old page just sits there — no spinner, no transition, nothing to say the
 * tap registered. The Studio copies of these pages have had one all along,
 * which is why they felt different.
 *
 * With a boundary the route commits immediately: the header paints, this
 * skeleton takes the body, and the real page swaps in when it arrives. The
 * second tap stops happening because the first one visibly did something.
 *
 * 🔴  is rendered HERE too, not just in the page. The fallback
 * replaces the whole route segment, so a skeleton without it would drop the
 * header for the length of the load and then bring it back — a flash that
 * reads worse than the wait it was meant to cover.
 *
 * The tool: picker, or whatever job is already running.
 */
export default function Loading() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, 4rem) + 1rem)" }}
      >
        <AICleanSkeleton />
      </main>
    </>
  );
}
