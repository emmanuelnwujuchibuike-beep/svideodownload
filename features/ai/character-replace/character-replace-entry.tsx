import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ENTRY CARD — Character Replace, on the Frenz AI page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §5):
 *
 *     [Character Replace]
 *     Put yourself into your video
 *     Upload a photo and an existing video. Frenz AI will create a new
 *     version using your likeness while preserving the original performance.
 *     [Start Creating]
 *
 * "The card should communicate that this is a premium feature without
 * looking like an advertisement." So: the product's own mark (the existing
 * `FrenzLogo`, never a substitute), a small NEW indicator in the same chip
 * style the rest of Frenz AI uses, the owner's copy verbatim, and one action.
 * No ratings, no testimonials, no claims — and one quiet tint of the brand
 * light in the corner, the same radial the welcome page already paints, so
 * it reads as part of that page rather than a banner dropped into it.
 *
 * A SERVER component: static markup with a link in it has no business in the
 * hydration budget. When the tool is off (`available === false`) the action
 * is a sentence, not a disabled button — there is nothing to press.
 */
export function CharacterReplaceEntry({
  href,
  available = true,
  className,
}: {
  href: string;
  /** False when the operator has switched the tool off. */
  available?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="character-replace-entry-title"
      className={cn(
        "relative overflow-hidden rounded-[1.5rem] bg-card/95 p-5 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-6",
        "shadow-[0_12px_32px_-20px_rgba(15,23,42,0.35)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 100% 0%, rgba(99,102,241,0.14) 0%, transparent 65%)," +
            "radial-gradient(50% 45% at 0% 100%, rgba(217,70,239,0.09) 0%, transparent 65%)",
        }}
      />

      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#131a4a]">
          <FrenzLogo size={18} alt="" />
        </span>
        <span className="text-[13px] font-semibold text-muted-foreground">Character Replace</span>
        <span className="ml-auto rounded-full border border-primary/25 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
          New
        </span>
      </div>

      <h2 id="character-replace-entry-title" className="mt-4 text-[1.55rem] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[1.85rem]">
        Put yourself into <span className="text-gradient">your video</span>
      </h2>
      <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
        Upload a photo and an existing video. Frenz AI will create a new version using your likeness while preserving
        the original performance.
      </p>

      {/*
          ── 🔴 A NATIVE-SIZED ACTION (owner, 2026-09-13: "make the Start
          Creating button have more height and look more premium like an iOS
          native app") ─────────────────────────────────────────────────────

          56 px tall, full width on a phone, a 16 px label and a squarer
          corner than the pill chips around it — the proportions of a large
          iOS button rather than a web link dressed as one. From `sm` up it
          sizes to its label, since a bar stretched across a desktop card
          reads as a banner. One quiet shadow under it, no gradient.
      */}
      {available ? (
        <Link
          href={href}
          prefetch={false}
          className={cn(
            "group mt-6 flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-[1.1rem] bg-foreground px-6",
            "text-[16px] font-semibold tracking-[-0.01em] text-background sm:w-auto sm:min-w-[13rem]",
            "shadow-[0_10px_24px_-14px_rgba(15,23,42,0.55)] transition duration-200",
            "motion-safe:hover:-translate-y-0.5 active:scale-[0.985] active:shadow-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          Start Creating
          <ArrowRight className="h-[18px] w-[18px] transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : (
        <p className="mt-5 text-[13px] font-semibold text-muted-foreground">Not available right now. Check back soon.</p>
      )}
    </section>
  );
}
